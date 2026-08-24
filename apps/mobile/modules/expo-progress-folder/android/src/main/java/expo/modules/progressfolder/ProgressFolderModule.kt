package expo.modules.progressfolder

import android.net.Uri
import android.os.Build
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
  }

  private data class DirectorySnapshot(
    val files: List<Map<String, Any?>>,
    val loading: Boolean,
    val providerError: String?
  )

  private fun context() = appContext.reactContext
    ?: throw IllegalStateException("The Android application context is unavailable.")

  private fun directoryDocumentUri(treeUri: Uri): Uri {
    val documentId = DocumentsContract.getTreeDocumentId(treeUri)
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
    val files = mutableListOf<Map<String, Any?>>()
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
        if (mimeType == DocumentsContract.Document.MIME_TYPE_DIR) continue
        val childId = it.getString(idColumn)
        files.add(
          mapOf(
            "name" to it.getString(nameColumn),
            "uri" to DocumentsContract.buildDocumentUriUsingTree(
              directoryUri,
              childId
            ).toString(),
            "size" to if (it.isNull(sizeColumn)) null else it.getLong(sizeColumn),
            "modifiedAt" to if (it.isNull(modifiedColumn)) null else it.getLong(modifiedColumn),
            "mimeType" to mimeType
          )
        )
      }
      return DirectorySnapshot(files, loading, providerError)
    }
  }

  private suspend fun awaitDirectoryFiles(treeUri: Uri): List<Map<String, Any?>> {
    while (true) {
      val snapshot = runInterruptible(Dispatchers.IO) { queryDirectory(treeUri) }
      if (!snapshot.loading) {
        if (snapshot.providerError != null) {
          throw IllegalStateException(
            "The file provider could not load the progress folder: ${snapshot.providerError}"
          )
        }
        return snapshot.files.sortedBy { it["name"] as? String ?: "" }
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
    return mapOf(
      "authority" to treeUri.authority,
      "isTreeUri" to (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
          DocumentsContract.isTreeUri(treeUri)
      ),
      "persistedReadPermission" to (persistedPermission?.isReadPermission == true),
      "persistedWritePermission" to (persistedPermission?.isWritePermission == true),
      "directChildCount" to snapshot.files.size,
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
