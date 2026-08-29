import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Platform, Text, View } from "react-native";

import { colors } from "@/components/app-ui";
import { BookGrid, BookGridSkeleton } from "@/components/book-grid";
import {
  CatalogToolbar,
  type CatalogOption,
} from "@/components/catalog-toolbar";
import {
  LibraryActionsSheet,
  type LibraryAction,
} from "@/components/library-book-actions";
import {
  useLibraryActions,
  useLibraryCatalog,
  useLibraryUiStatus,
} from "@/context/library-context";
import { useExtensions } from "@/context/extensions-context";
import { useSettings } from "@/context/settings-context";
import {
  openBookWithAnotherApp,
  showBookInFiles,
} from "@/lib/book-file-actions";
import {
  detailParams,
  toExtensionLibraryBook,
  type LibraryBook,
} from "@/lib/library";

type FormatFilter =
  | "all"
  | "finished"
  | "epub"
  | "pdf"
  | "mobi"
  | "azw3"
  | "other";
type LibrarySort =
  | "recent"
  | "downloaded"
  | "title"
  | "author"
  | "rating"
  | "progress";

const FILTERS: CatalogOption<FormatFilter>[] = [
  { label: "All", value: "all" },
  { label: "Finished", value: "finished" },
  { label: "EPUB", value: "epub" },
  { label: "PDF", value: "pdf" },
  { label: "MOBI", value: "mobi" },
  { label: "AZW3", value: "azw3" },
  { label: "Other", value: "other" },
];

const SORTS: CatalogOption<LibrarySort>[] = [
  { label: "Recent", value: "recent" },
  { label: "Downloaded", value: "downloaded" },
  { label: "A–Z", value: "title" },
  { label: "Author", value: "author" },
  { label: "Rating", value: "rating" },
  { label: "Progress", value: "progress" },
];

const MAIN_FORMATS = new Set(["epub", "pdf", "mobi", "azw3"]);

export default function LibraryScreen() {
  const router = useRouter();
  const { downloaded, ready } = useLibraryCatalog();
  const { scanning, showWarning } = useLibraryUiStatus();
  const {
    markAsRead,
    removeLibraryBook,
    removeLocalFile,
    refreshBookMetadata,
    refreshLocalBooks,
  } = useLibraryActions();
  const { settings } = useSettings();
  const extensions = useExtensions();
  const [format, setFormat] = useState<FormatFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null);
  const [busyAction, setBusyAction] = useState<LibraryAction | null>(null);

  const books = useMemo(() => {
    const filtered = downloaded.filter((book) => {
      const bookFormat = book.format?.toLowerCase() || "";
      if (format === "all") return true;
      if (format === "finished") return book.isRead === true;
      if (format === "other") return !MAIN_FORMATS.has(bookFormat);
      return bookFormat === format;
    });
    return filtered.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "author") return a.author.localeCompare(b.author);
      if (sort === "rating") return (b.rating ?? -1) - (a.rating ?? -1);
      if (sort === "progress") return (b.progress ?? -1) - (a.progress ?? -1);
      if (sort === "downloaded")
        return (b.downloadedAt ?? -1) - (a.downloadedAt ?? -1);
      return (b.downloadedAt ?? b.addedAt) - (a.downloadedAt ?? a.addedAt);
    });
  }, [downloaded, format, sort]);

  const openBook = useCallback(
    (book: LibraryBook) => router.push(detailParams(book) as any),
    [router],
  );

  const loading = !ready || (scanning && downloaded.length === 0);

  const runAction = useCallback(
    async (action: LibraryAction, operation: () => Promise<void>) => {
      setBusyAction(action);
      try {
        await operation();
        setSelectedBook(null);
      } catch (err: any) {
        showWarning(err.message || String(err));
      } finally {
        setBusyAction(null);
      }
    },
    [showWarning],
  );

  const addonActions = useMemo(() => {
    if (!selectedBook) return [];
    const book = toExtensionLibraryBook(selectedBook);
    const platform =
      Platform.OS === "android" ||
      Platform.OS === "ios" ||
      Platform.OS === "web"
        ? Platform.OS
        : "desktop";
    return extensions
      .libraryActions(book, "library", platform)
      .map((action) => ({
        key: `addon:${action.extensionId}:${action.id}` as const,
        label: action.title,
        icon: (action.icon && action.icon in Feather.glyphMap
          ? action.icon
          : "external-link") as "external-link",
        onPress: () =>
          void runAction(`addon:${action.extensionId}:${action.id}`, () =>
            extensions.runLibraryAction(action.extensionId, action.id, book),
          ),
      }));
  }, [extensions, runAction, selectedBook]);

  const confirmRemove = useCallback(() => {
    if (!selectedBook) return;
    const localRecord = !!(selectedBook.local?.uri ?? selectedBook.fileUri);
    const localFileAvailable =
      localRecord && selectedBook.availableLocally !== false;
    Alert.alert(
      localRecord ? "Remove from Tomeio?" : "Remove synced book?",
      localRecord
        ? localFileAvailable
          ? `“${selectedBook.title}” and its local file will be permanently removed from Tomeio.`
          : `“${selectedBook.title}” will be removed from your library. The missing file will not be deleted again.`
        : `“${selectedBook.title}” will be removed from Tomeio on every synced device. Newer Moon+ Reader activity can add it again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            void runAction("remove", () => removeLibraryBook(selectedBook)),
        },
      ],
    );
  }, [removeLibraryBook, runAction, selectedBook]);

  const confirmDelete = useCallback(() => {
    if (!selectedBook?.local) return;
    Alert.alert(
      "Remove local file?",
      `The file for “${selectedBook.title}” will be deleted, but its library and sync record will be kept.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            void runAction("delete", () => removeLocalFile(selectedBook)),
        },
      ],
    );
  }, [removeLocalFile, runAction, selectedBook]);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <CatalogToolbar
        filterLabel="Format"
        filters={FILTERS}
        selectedFilter={format}
        onFilter={setFormat}
        sorts={SORTS}
        selectedSort={sort}
        onSort={setSort}
        sortLabel="Sort by"
      />
      {loading ? (
        <BookGridSkeleton />
      ) : (
        <BookGrid
          books={books}
          onPressBook={openBook}
          onLongPressBook={setSelectedBook}
          onRefresh={() => void refreshLocalBooks()}
          refreshing={scanning}
          ListEmptyComponent={
            <Text className="mt-20 px-8 text-center text-sm text-neutral-500">
              {downloaded.length
                ? "No books match this format."
                : "Books in your selected folder will appear here."}
            </Text>
          }
        />
      )}
      {!!selectedBook && (
        <LibraryActionsSheet
          book={selectedBook}
          visible
          busyAction={busyAction}
          addonActions={addonActions}
          onClose={() => setSelectedBook(null)}
          onOpenWith={() =>
            void runAction("openWith", () =>
              openBookWithAnotherApp(selectedBook),
            )
          }
          onShowInFiles={() =>
            void runAction("files", () =>
              showBookInFiles(selectedBook, settings.localLibraryLocation),
            )
          }
          onDelete={confirmDelete}
          onRemove={confirmRemove}
          onMarkRead={() =>
            void runAction("read", () => markAsRead(selectedBook))
          }
          onRefreshMetadata={() =>
            void runAction("metadata", () => refreshBookMetadata(selectedBook))
          }
        />
      )}
    </View>
  );
}
