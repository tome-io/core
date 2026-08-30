package expo.modules.progressfolder

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import java.nio.charset.StandardCharsets

class ProgressFolderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ProgressFolder")

    AsyncFunction("listFiles") Coroutine { directoryUri: String ->
      try {
        withTimeout(DIRECTORY_TIMEOUT_MS) {
          awaitDirectoryFiles(Uri.parse(directoryUri))
        }
      } catch (_: TimeoutCancellationException) {
        throw IllegalStateException(
          "The file provider did not finish loading the progress folder within 20 seconds."
        )
      }
    }

    AsyncFunction("listDirectoryEntries") Coroutine { directoryUri: String ->
      try {
        withTimeout(DIRECTORY_TIMEOUT_MS) {
          awaitDirectoryEntries(Uri.parse(directoryUri))
        }
      } catch (_: TimeoutCancellationException) {
        throw IllegalStateException(
          "The file provider did not finish loading the folder within 20 seconds."
        )
      }
    }

    AsyncFunction("readTextFile") Coroutine { fileUri: String ->
      try {
        withTimeout(FILE_TIMEOUT_MS) {
          runInterruptible(Dispatchers.IO) {
            readTextFile(Uri.parse(fileUri))
          }
        }
      } catch (_: TimeoutCancellationException) {
        throw IllegalStateException(
          "The file provider did not make the progress file readable within 30 seconds."
        )
      }
    }

    AsyncFunction("createTextFile") Coroutine {
        directoryUri: String,
        filename: String,
        contents: String ->
      try {
        withTimeout(FILE_TIMEOUT_MS) {
          runInterruptible(Dispatchers.IO) {
            createTextFile(Uri.parse(directoryUri), filename, contents)
          }
        }
      } catch (_: TimeoutCancellationException) {
        throw IllegalStateException(
          "The file provider did not create the progress file within 30 seconds."
        )
      }
    }

    AsyncFunction("writeTextFile") Coroutine { fileUri: String, contents: String ->
      try {
        withTimeout(FILE_TIMEOUT_MS) {
          runInterruptible(Dispatchers.IO) {
            writeTextFile(Uri.parse(fileUri), contents)
          }
        }
      } catch (_: TimeoutCancellationException) {
        throw IllegalStateException(
          "The file provider did not update the progress file within 30 seconds."
        )
      }
    }

    AsyncFunction("getDirectoryDiagnostics") Coroutine { directoryUri: String ->
      try {
        withTimeout(DIRECTORY_TIMEOUT_MS) {
          runInterruptible(Dispatchers.IO) {
            directoryDiagnostics(Uri.parse(directoryUri))
          }
        }
      } catch (_: TimeoutCancellationException) {
        throw IllegalStateException(
          "The file provider did not inspect the progress folder within 20 seconds."
        )
      }
    }

    AsyncFunction("copyFileToDirectory") Coroutine {
        sourceUri: String,
        directoryUri: String,
        filename: String,
        mimeType: String ->
      runInterruptible(Dispatchers.IO) {
        copyFileToDirectory(
          sourceUri,
          Uri.parse(directoryUri),
          filename,
          mimeType
        )
      }
    }

    AsyncFunction("ensureDirectory") Coroutine { directoryUri: String, name: String ->
      runInterruptible(Dispatchers.IO) {
        ensureDirectory(Uri.parse(directoryUri), name).toString()
      }
    }

    AsyncFunction("copyFileToLocal") Coroutine { sourceUri: String, destinationUri: String ->
      runInterruptible(Dispatchers.IO) {
        copyFileToLocal(sourceUri, Uri.parse(destinationUri))
      }
    }

    AsyncFunction("renderPdfCover") Coroutine {
        sourceUri: String,
        destinationUri: String,
        maxWidth: Int ->
      runInterruptible(Dispatchers.IO) {
        renderPdfCover(sourceUri, Uri.parse(destinationUri), maxWidth)
      }
    }

    AsyncFunction("deleteFile") Coroutine { fileUri: String ->
      runInterruptible(Dispatchers.IO) {
        deleteFile(Uri.parse(fileUri))
      }
    }

    AsyncFunction("openDirectory") { directoryUri: String ->
      openDirectory(Uri.parse(directoryUri))
    }
  }

  private data class DirectorySnapshot(
    val entries: List<Map<String, Any?>>,
    val loading: Boolean,
    val providerError: String?
  )

  private fun context() = appContext.reactContext
    ?: throw IllegalStateException("The Android application context is unavailable.")

  private fun directoryDocumentUri(treeUri: Uri): Uri {
    if (treeUri.scheme != "content") {
      throw IllegalArgumentException("Only Android document-provider folders can be read here.")
    }
    val treeDocumentId = try {
      DocumentsContract.getTreeDocumentId(treeUri)
    } catch (_: IllegalArgumentException) {
      throw IllegalArgumentException("The selected location is not an Android document-provider folder.")
    }
    val documentId = if (DocumentsContract.isDocumentUri(context(), treeUri)) {
      DocumentsContract.getDocumentId(treeUri)
    } else {
      treeDocumentId
    }
    return DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
  }

  private fun queryDirectory(treeUri: Uri): DirectorySnapshot {
    val resolver = context().contentResolver
    val directoryUri = directoryDocumentUri(treeUri)
    val documentId = DocumentsContract.getDocumentId(directoryUri)
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
      directoryUri,
      documentId
    )
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )
    val entries = mutableListOf<Map<String, Any?>>()
    val cursor = resolver.query(childrenUri, projection, null, null, null)
      ?: throw IllegalStateException("The file provider did not return the folder contents.")

    cursor.use {
      val loading = it.extras.getBoolean(DocumentsContract.EXTRA_LOADING, false)
      val providerError = it.extras.get(DocumentsContract.EXTRA_ERROR)?.toString()
      val idColumn = it.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID
      )
      val nameColumn = it.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_DISPLAY_NAME
      )
      val typeColumn = it.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_MIME_TYPE
      )
      val sizeColumn = it.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_SIZE
      )
      val modifiedColumn = it.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
      )

      while (it.moveToNext()) {
        val mimeType = it.getString(typeColumn)
        val childId = it.getString(idColumn)
        entries.add(
          mapOf(
            "name" to it.getString(nameColumn),
            "uri" to DocumentsContract.buildDocumentUriUsingTree(
              directoryUri,
              childId
            ).toString(),
            "size" to if (it.isNull(sizeColumn)) null else it.getLong(sizeColumn),
            "modifiedAt" to if (it.isNull(modifiedColumn)) null else it.getLong(modifiedColumn),
            "mimeType" to mimeType,
            "isDirectory" to (mimeType == DocumentsContract.Document.MIME_TYPE_DIR)
          )
        )
      }
      return DirectorySnapshot(entries, loading, providerError)
    }
  }

  private suspend fun awaitDirectoryFiles(treeUri: Uri): List<Map<String, Any?>> {
    return awaitDirectoryEntries(treeUri)
      .filter { (it["isDirectory"] as? Boolean) != true }
      .map { entry ->
        entry.toMutableMap().apply { remove("isDirectory") }
      }
  }

  private suspend fun awaitDirectoryEntries(treeUri: Uri): List<Map<String, Any?>> {
    while (true) {
      val snapshot = runInterruptible(Dispatchers.IO) { queryDirectory(treeUri) }
      if (!snapshot.loading) {
        if (snapshot.providerError != null) {
          throw IllegalStateException(
            "The file provider could not load the progress folder: ${snapshot.providerError}"
          )
        }
        return snapshot.entries.sortedBy { it["name"] as? String ?: "" }
      }
      delay(DIRECTORY_RETRY_DELAY_MS)
    }
  }

  private fun readTextFile(fileUri: Uri): String {
    val input = context().contentResolver.openInputStream(fileUri)
      ?: throw IllegalStateException("The file provider could not open the progress file.")
    input.use { source ->
      val output = ByteArrayOutputStream()
      val buffer = ByteArray(8 * 1024)
      var total = 0
      while (true) {
        val count = source.read(buffer)
        if (count < 0) break
        total += count
        if (total > MAX_SYNC_FILE_BYTES) {
          throw IllegalStateException("The progress file is unexpectedly large.")
        }
        output.write(buffer, 0, count)
      }
      return output.toString(StandardCharsets.UTF_8.name())
    }
  }

  private fun createTextFile(
    treeUri: Uri,
    filename: String,
    contents: String
  ): String {
    validateContents(contents)
    val resolver = context().contentResolver
    val created = DocumentsContract.createDocument(
      resolver,
      directoryDocumentUri(treeUri),
      JSON_MIME_TYPE,
      filename
    ) ?: throw IllegalStateException("The file provider did not create the progress file.")
    try {
      writeTextFile(created, contents)
      return created.toString()
    } catch (error: Throwable) {
      runCatching { DocumentsContract.deleteDocument(resolver, created) }
      throw error
    }
  }

  private fun writeTextFile(fileUri: Uri, contents: String) {
    validateContents(contents)
    val output = context().contentResolver.openOutputStream(fileUri, "wt")
      ?: throw IllegalStateException("The file provider could not open the progress file for writing.")
    output.bufferedWriter(StandardCharsets.UTF_8).use { writer ->
      writer.write(contents)
      writer.flush()
    }
  }

  private fun sourceStream(sourceUri: String): InputStream {
    val uri = Uri.parse(sourceUri)
    return when (uri.scheme) {
      "content" -> context().contentResolver.openInputStream(uri)
      "file" -> uri.path?.let { File(it).inputStream() }
      null -> File(sourceUri).inputStream()
      else -> null
    } ?: throw IllegalStateException("The downloaded file could not be opened.")
  }

  private fun findChild(treeUri: Uri, filename: String): Uri? {
    val resolver = context().contentResolver
    val directoryUri = directoryDocumentUri(treeUri)
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
      directoryUri,
      DocumentsContract.getDocumentId(directoryUri)
    )
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME
    )
    val cursor = resolver.query(childrenUri, projection, null, null, null)
      ?: throw IllegalStateException("The file provider did not return the folder contents.")
    cursor.use {
      val idColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      while (it.moveToNext()) {
        if (it.getString(nameColumn) == filename) {
          return DocumentsContract.buildDocumentUriUsingTree(
            directoryUri,
            it.getString(idColumn)
          )
        }
      }
    }
    return null
  }

  private fun ensureDirectory(treeUri: Uri, name: String): Uri {
    if (name.isBlank() || name == "." || name == ".." || name.contains('/')) {
      throw IllegalArgumentException("The destination folder name is invalid.")
    }
    val existing = findChild(treeUri, name)
    if (existing != null) {
      val mimeType = context().contentResolver.getType(existing)
      if (mimeType != DocumentsContract.Document.MIME_TYPE_DIR) {
        throw IllegalStateException("A file named $name prevents Tomeio from creating the mirrored folder.")
      }
      return existing
    }
    return DocumentsContract.createDocument(
      context().contentResolver,
      directoryDocumentUri(treeUri),
      DocumentsContract.Document.MIME_TYPE_DIR,
      name
    ) ?: throw IllegalStateException("The file provider did not create the mirrored folder.")
  }

  private fun copyFileToDirectory(
    sourceUri: String,
    treeUri: Uri,
    filename: String,
    mimeType: String
  ): String {
    val resolver = context().contentResolver
    var created = false
    val destination = findChild(treeUri, filename) ?: DocumentsContract.createDocument(
      resolver,
      directoryDocumentUri(treeUri),
      mimeType,
      filename
    )?.also { created = true }
      ?: throw IllegalStateException("The file provider did not create the downloaded book.")

    try {
      sourceStream(sourceUri).use { input ->
        val output = resolver.openOutputStream(destination, "wt")
          ?: throw IllegalStateException("The file provider could not open the downloaded book for writing.")
        output.use { input.copyTo(it, 64 * 1024) }
      }
      return destination.toString()
    } catch (error: Throwable) {
      if (created) runCatching { DocumentsContract.deleteDocument(resolver, destination) }
      throw error
    }
  }

  private fun copyFileToLocal(sourceUri: String, destinationUri: Uri) {
    if (destinationUri.scheme != "file" || destinationUri.path == null) {
      throw IllegalArgumentException("The local destination is invalid.")
    }
    val destination = File(destinationUri.path!!)
    val parent = destination.parentFile
      ?: throw IllegalArgumentException("The local destination has no parent directory.")
    if (!parent.exists() && !parent.mkdirs()) {
      throw IllegalStateException("The app cache directory could not be created.")
    }
    val temporary = File(parent, ".tomeio-copy-${System.nanoTime()}")
    try {
      sourceStream(sourceUri).use { input ->
        temporary.outputStream().use { output ->
          input.copyTo(output, 64 * 1024)
        }
      }
      if (destination.exists() && !destination.delete()) {
        throw IllegalStateException("The previous cached file could not be replaced.")
      }
      if (!temporary.renameTo(destination)) {
        throw IllegalStateException("The selected file could not be moved into the app cache.")
      }
    } catch (error: Throwable) {
      temporary.delete()
      throw error
    }
  }

  private fun readOnlyFileDescriptor(sourceUri: String): ParcelFileDescriptor {
    val uri = Uri.parse(sourceUri)
    return when (uri.scheme) {
      "content" -> context().contentResolver.openFileDescriptor(uri, "r")
      "file" -> uri.path?.let {
        ParcelFileDescriptor.open(File(it), ParcelFileDescriptor.MODE_READ_ONLY)
      }
      null -> ParcelFileDescriptor.open(File(sourceUri), ParcelFileDescriptor.MODE_READ_ONLY)
      else -> null
    } ?: throw IllegalStateException("The PDF could not be opened for cover extraction.")
  }

  private fun renderPdfCover(
    sourceUri: String,
    destinationUri: Uri,
    maxWidth: Int
  ): Map<String, Any> {
    if (destinationUri.scheme != "file" || destinationUri.path == null) {
      throw IllegalArgumentException("The PDF cover destination is invalid.")
    }
    if (maxWidth !in 240..2048) {
      throw IllegalArgumentException("The PDF cover width is invalid.")
    }
    val destination = File(destinationUri.path!!)
    val parent = destination.parentFile
      ?: throw IllegalArgumentException("The PDF cover destination has no parent directory.")
    if (!parent.exists() && !parent.mkdirs()) {
      throw IllegalStateException("The PDF cover directory could not be created.")
    }
    val temporary = File(parent, ".tomeio-pdf-cover-${System.nanoTime()}")
    try {
      readOnlyFileDescriptor(sourceUri).use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
          if (renderer.pageCount < 1) {
            throw IllegalStateException("The PDF has no pages to use as a cover.")
          }
          renderer.openPage(0).use { page ->
            val scale = minOf(
              maxWidth.toFloat() / page.width.toFloat(),
              1600f / page.height.toFloat()
            )
            val width = (page.width * scale).toInt().coerceAtLeast(1)
            val height = (page.height * scale).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            try {
              bitmap.eraseColor(Color.WHITE)
              val matrix = Matrix().apply { setScale(scale, scale) }
              page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
              temporary.outputStream().use { output ->
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output)) {
                  throw IllegalStateException("The PDF cover could not be encoded.")
                }
              }
            } finally {
              bitmap.recycle()
            }
            if (destination.exists() && !destination.delete()) {
              throw IllegalStateException("The previous PDF cover could not be replaced.")
            }
            if (!temporary.renameTo(destination)) {
              throw IllegalStateException("The PDF cover could not be saved.")
            }
            return mapOf(
              "uri" to destinationUri.toString(),
              "width" to width,
              "height" to height
            )
          }
        }
      }
    } catch (error: Throwable) {
      temporary.delete()
      throw error
    }
  }

  private fun deleteFile(fileUri: Uri) {
    if (fileUri.scheme != "content") {
      throw IllegalArgumentException("Only Android document-provider files can be deleted here.")
    }
    try {
      if (!DocumentsContract.deleteDocument(context().contentResolver, fileUri)) {
        throw IllegalStateException("The file provider refused to delete the book.")
      }
    } catch (_: FileNotFoundException) {
      // Deletion is idempotent: a file removed outside Tomeio is already in the desired state.
    }
  }

  private fun openDirectory(treeUri: Uri) {
    if (treeUri.scheme != "content") {
      throw IllegalArgumentException("Only Android document-provider folders can be opened here.")
    }
    val directoryUri = directoryDocumentUri(treeUri)
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
      Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
      Intent.FLAG_ACTIVITY_NEW_TASK
    val intents = listOf(
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(directoryUri, DocumentsContract.Document.MIME_TYPE_DIR)
        addFlags(flags)
      },
      Intent("android.provider.action.BROWSE").apply {
        setDataAndType(directoryUri, DocumentsContract.Document.MIME_TYPE_DIR)
        addFlags(flags)
      }
    )
    for (intent in intents) {
      try {
        context().startActivity(intent)
        return
      } catch (_: ActivityNotFoundException) {
        // Try the DocumentsUI browse action when a file manager does not support ACTION_VIEW.
      }
    }
    throw IllegalStateException("No installed file manager can open the Books folder.")
  }

  private fun validateContents(contents: String) {
    if (contents.toByteArray(StandardCharsets.UTF_8).size > MAX_SYNC_FILE_BYTES) {
      throw IllegalArgumentException("The progress file is unexpectedly large.")
    }
  }

  private fun directoryDiagnostics(treeUri: Uri): Map<String, Any?> {
    val resolver = context().contentResolver
    val snapshot = queryDirectory(treeUri)
    val normalizedUri = treeUri.toString().trimEnd('/')
    val persistedPermission = resolver.persistedUriPermissions.firstOrNull {
      it.uri.toString().trimEnd('/') == normalizedUri
    }
    val authority = treeUri.authority
    val displayName = resolver.query(
      directoryDocumentUri(treeUri),
      arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
      null,
      null,
      null
    )?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else null
    }
    val storageKind = when (authority) {
      "com.google.android.apps.docs.storage" -> "cloud"
      "com.android.externalstorage.documents",
      "com.android.providers.downloads.documents",
      "com.android.providers.media.documents" -> "device"
      else -> "unknown"
    }
    return mapOf(
      "authority" to authority,
      "displayName" to displayName,
      "storageKind" to storageKind,
      "isTreeUri" to (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
          DocumentsContract.isTreeUri(treeUri)
      ),
      "persistedReadPermission" to (persistedPermission?.isReadPermission == true),
      "persistedWritePermission" to (persistedPermission?.isWritePermission == true),
      "directChildCount" to snapshot.entries.size,
      "providerLoading" to snapshot.loading,
      "providerError" to snapshot.providerError
    )
  }

  private companion object {
    const val JSON_MIME_TYPE = "application/json"
    const val DIRECTORY_TIMEOUT_MS = 20_000L
    const val FILE_TIMEOUT_MS = 30_000L
    const val DIRECTORY_RETRY_DELAY_MS = 500L
    const val MAX_SYNC_FILE_BYTES = 2 * 1024 * 1024
  }
}
