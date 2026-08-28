import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

private let tokenScheme = "tomeio-folder"
private let bookmarkPrefix = "tomeio.folder.bookmark."
private let maxTextFileBytes = 2 * 1024 * 1024

private struct FolderReference {
  let identifier: String
  let relativeComponents: [String]
}

private final class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private let onPick: (URL) -> Void
  private let onCancel: () -> Void
  private var finished = false

  init(onPick: @escaping (URL) -> Void, onCancel: @escaping () -> Void) {
    self.onPick = onPick
    self.onCancel = onCancel
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let url = urls.first else {
      cancel()
      return
    }
    guard !finished else { return }
    finished = true
    onPick(url)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    cancel()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    cancel()
  }

  private func cancel() {
    guard !finished else { return }
    finished = true
    onCancel()
  }
}

public final class ProgressFolderModule: Module {
  private var pickerDelegate: FolderPickerDelegate?

  public func definition() -> ModuleDefinition {
    Name("ProgressFolder")

    AsyncFunction("pickDirectory") { (initialDirectoryUri: String?, promise: Promise) in
      guard self.pickerDelegate == nil else {
        promise.reject(folderError("A folder picker is already open."))
        return
      }
      guard let viewController = self.appContext?.utilities?.currentViewController() else {
        promise.reject(folderError("The folder picker could not find an active screen."))
        return
      }

      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: [UTType.folder],
        asCopy: false
      )
      if let initialDirectoryUri,
         !initialDirectoryUri.hasPrefix("\(tokenScheme):"),
         let initialURL = URL(string: initialDirectoryUri) {
        picker.directoryURL = initialURL
      }

      let finish: () -> Void = { [weak self] in
        self?.pickerDelegate = nil
      }
      let delegate = FolderPickerDelegate(
        onPick: { [weak self] url in
          defer { finish() }
          do {
            guard let self else { throw folderError("Folder access was interrupted.") }
            promise.resolve(try self.storeBookmark(for: url))
          } catch {
            promise.reject(error)
          }
        },
        onCancel: {
          finish()
          promise.resolve(nil)
        }
      )
      pickerDelegate = delegate
      picker.delegate = delegate
      picker.presentationController?.delegate = delegate

      if UIDevice.current.userInterfaceIdiom == .pad {
        picker.popoverPresentationController?.sourceView = viewController.view
        picker.popoverPresentationController?.sourceRect = CGRect(
          x: viewController.view.bounds.midX,
          y: viewController.view.bounds.maxY,
          width: 0,
          height: 0
        )
      }
      viewController.present(picker, animated: true)
    }.runOnQueue(.main)

    AsyncFunction("listFiles") { (directoryUri: String) throws -> [[String: Any?]] in
      try self.withResolvedURL(directoryUri) { url, reference in
        try self.directoryEntries(at: url, reference: reference)
          .filter { ($0["isDirectory"] as? Bool) == false }
          .map { entry in
            var file = entry
            file.removeValue(forKey: "isDirectory")
            return file
          }
      }
    }

    AsyncFunction("listDirectoryEntries") { (directoryUri: String) throws -> [[String: Any?]] in
      try self.withResolvedURL(directoryUri) { url, reference in
        try self.directoryEntries(at: url, reference: reference)
      }
    }

    AsyncFunction("readTextFile") { (fileUri: String) throws -> String in
      try self.withResolvedURL(fileUri) { url, _ in
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard data.count <= maxTextFileBytes else {
          throw folderError("The progress file is unexpectedly large.")
        }
        guard let contents = String(data: data, encoding: .utf8) else {
          throw folderError("The progress file is not valid UTF-8 text.")
        }
        return contents
      }
    }

    AsyncFunction("createTextFile") {
      (directoryUri: String, filename: String, contents: String) throws -> String in
      try self.validateFilename(filename)
      try self.validateText(contents)
      return try self.withResolvedURL(directoryUri) { directoryURL, reference in
        let destination = directoryURL.appendingPathComponent(filename, isDirectory: false)
        guard !FileManager.default.fileExists(atPath: destination.path) else {
          throw folderError("A progress file named \(filename) already exists.")
        }
        try contents.write(to: destination, atomically: true, encoding: .utf8)
        return self.token(for: reference.identifier, path: reference.relativeComponents + [filename])
      }
    }

    AsyncFunction("writeTextFile") { (fileUri: String, contents: String) throws in
      try self.validateText(contents)
      try self.withResolvedURL(fileUri) { url, _ in
        try contents.write(to: url, atomically: true, encoding: .utf8)
      }
    }

    AsyncFunction("getDirectoryDiagnostics") { (directoryUri: String) throws -> [String: Any?] in
      try self.withResolvedURL(directoryUri) { url, reference in
        let entries = try self.directoryEntries(at: url, reference: reference)
        var providerError: String?
        let probe = url.appendingPathComponent(".tomeio-write-test-\(UUID().uuidString)")
        do {
          try Data().write(to: probe, options: .atomic)
          try FileManager.default.removeItem(at: probe)
        } catch {
          try? FileManager.default.removeItem(at: probe)
          providerError = "Write access failed: \(error.localizedDescription)"
        }
        return [
          "authority": "ios-security-scoped",
          "isTreeUri": true,
          "persistedReadPermission": true,
          "persistedWritePermission": providerError == nil,
          "directChildCount": entries.count,
          "providerLoading": false,
          "providerError": providerError
        ]
      }
    }

    AsyncFunction("copyFileToDirectory") {
      (sourceUri: String, directoryUri: String, filename: String, mimeType: String) throws -> String in
      try self.validateFilename(filename)
      return try self.withResolvedURL(directoryUri) { directoryURL, reference in
        let sourceURL = try self.localFileURL(sourceUri)
        let destination = directoryURL.appendingPathComponent(filename, isDirectory: false)
        try self.replaceFile(from: sourceURL, to: destination)
        return self.token(for: reference.identifier, path: reference.relativeComponents + [filename])
      }
    }

    AsyncFunction("copyFileToLocal") { (sourceUri: String, destinationUri: String) throws in
      guard let destination = URL(string: destinationUri), destination.isFileURL else {
        throw folderError("The local destination is invalid.")
      }
      try self.withResolvedURL(sourceUri) { source, _ in
        try FileManager.default.createDirectory(
          at: destination.deletingLastPathComponent(),
          withIntermediateDirectories: true
        )
        try self.replaceFile(from: source, to: destination)
      }
    }

    AsyncFunction("deleteFile") { (fileUri: String) throws in
      try self.withResolvedURL(fileUri) { url, reference in
        guard !reference.relativeComponents.isEmpty else {
          throw folderError("The selected root folder cannot be deleted.")
        }
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
      }
    }

    AsyncFunction("forgetDirectory") { (directoryUri: String) throws in
      let reference = try self.parseToken(directoryUri)
      UserDefaults.standard.removeObject(forKey: bookmarkPrefix + reference.identifier)
    }
  }

  private func storeBookmark(for url: URL) throws -> [String: String] {
    let accessed = url.startAccessingSecurityScopedResource()
    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
    guard accessed else {
      throw folderError("iOS did not grant access to the selected folder.")
    }
    let bookmark = try url.bookmarkData(
      options: [],
      includingResourceValuesForKeys: nil,
      relativeTo: nil
    )
    let identifier = UUID().uuidString.lowercased()
    UserDefaults.standard.set(bookmark, forKey: bookmarkPrefix + identifier)
    return ["uri": token(for: identifier, path: [], name: url.lastPathComponent)]
  }

  private func parseToken(_ value: String) throws -> FolderReference {
    guard let components = URLComponents(string: value),
          components.scheme == tokenScheme,
          let identifier = components.host,
          !identifier.isEmpty else {
      throw folderError("The selected iOS folder reference is invalid.")
    }
    let path = components.path.split(separator: "/").map(String.init)
    guard path.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
      throw folderError("The selected folder path is invalid.")
    }
    return FolderReference(identifier: identifier, relativeComponents: path)
  }

  private func withResolvedURL<T>(
    _ token: String,
    operation: (URL, FolderReference) throws -> T
  ) throws -> T {
    let reference = try parseToken(token)
    let key = bookmarkPrefix + reference.identifier
    guard let bookmark = UserDefaults.standard.data(forKey: key) else {
      throw folderError("Access to this iOS folder has expired. Choose the folder again in Settings.")
    }
    var stale = false
    let root = try URL(
      resolvingBookmarkData: bookmark,
      options: [.withoutUI, .withoutImplicitStartAccessing],
      relativeTo: nil,
      bookmarkDataIsStale: &stale
    )
    let accessed = root.startAccessingSecurityScopedResource()
    guard accessed else {
      throw folderError("iOS could not restore access to this folder. Choose it again in Settings.")
    }
    defer { root.stopAccessingSecurityScopedResource() }
    if stale {
      let refreshed = try root.bookmarkData(
        options: [],
        includingResourceValuesForKeys: nil,
        relativeTo: nil
      )
      UserDefaults.standard.set(refreshed, forKey: key)
    }
    let resolved = reference.relativeComponents.reduce(root) {
      $0.appendingPathComponent($1)
    }
    return try operation(resolved, reference)
  }

  private func directoryEntries(
    at url: URL,
    reference: FolderReference
  ) throws -> [[String: Any?]] {
    let keys: Set<URLResourceKey> = [
      .isDirectoryKey,
      .fileSizeKey,
      .contentModificationDateKey,
      .contentTypeKey,
      .isSymbolicLinkKey
    ]
    let urls = try FileManager.default.contentsOfDirectory(
      at: url,
      includingPropertiesForKeys: Array(keys),
      options: [.skipsHiddenFiles]
    )
    return try urls.compactMap { child in
      let values = try child.resourceValues(forKeys: keys)
      if values.isSymbolicLink == true { return nil }
      let isDirectory = values.isDirectory == true
      return [
        "name": child.lastPathComponent,
        "uri": token(
          for: reference.identifier,
          path: reference.relativeComponents + [child.lastPathComponent]
        ),
        "size": isDirectory ? nil : values.fileSize,
        "modifiedAt": values.contentModificationDate.map { $0.timeIntervalSince1970 * 1000 },
        "mimeType": values.contentType?.preferredMIMEType,
        "isDirectory": isDirectory
      ]
    }.sorted {
      (($0["name"] as? String) ?? "").localizedCaseInsensitiveCompare(
        ($1["name"] as? String) ?? ""
      ) == .orderedAscending
    }
  }

  private func token(for identifier: String, path: [String], name: String? = nil) -> String {
    var components = URLComponents()
    components.scheme = tokenScheme
    components.host = identifier
    components.path = path.isEmpty ? "" : "/" + path.joined(separator: "/")
    if let name, !name.isEmpty {
      components.queryItems = [URLQueryItem(name: "name", value: name)]
    }
    return components.string ?? "\(tokenScheme)://\(identifier)"
  }

  private func validateFilename(_ filename: String) throws {
    guard !filename.isEmpty,
          filename != ".",
          filename != "..",
          !filename.contains("/"),
          !filename.contains(":") else {
      throw folderError("The destination filename is invalid.")
    }
  }

  private func validateText(_ contents: String) throws {
    guard contents.lengthOfBytes(using: .utf8) <= maxTextFileBytes else {
      throw folderError("The progress file is unexpectedly large.")
    }
  }

  private func localFileURL(_ value: String) throws -> URL {
    if let url = URL(string: value), url.isFileURL { return url }
    if value.hasPrefix("/") { return URL(fileURLWithPath: value) }
    throw folderError("The downloaded file could not be opened.")
  }

  private func replaceFile(from source: URL, to destination: URL) throws {
    let manager = FileManager.default
    let temporary = destination.deletingLastPathComponent()
      .appendingPathComponent(".tomeio-copy-\(UUID().uuidString)")
    do {
      try manager.copyItem(at: source, to: temporary)
      if manager.fileExists(atPath: destination.path) {
        _ = try manager.replaceItemAt(destination, withItemAt: temporary)
      } else {
        try manager.moveItem(at: temporary, to: destination)
      }
    } catch {
      try? manager.removeItem(at: temporary)
      throw error
    }
  }
}

private func folderError(_ message: String) -> NSError {
  NSError(
    domain: "ExpoProgressFolder",
    code: 1,
    userInfo: [NSLocalizedDescriptionKey: message]
  )
}
