import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";

import { colors } from "@/components/app-ui";
import { BookGrid, BookGridSkeleton } from "@/components/book-grid";
import {
  CatalogToolbar,
  type CatalogOption,
} from "@/components/catalog-toolbar";
import {
  useLibraryReadingList,
  useLibraryUiStatus,
} from "@/context/library-context";
import { useSettings } from "@/context/settings-context";
import { detailParams, type LibraryBook } from "@/lib/library";

type ReadingSort = "recent" | "title" | "author" | "rating";

const SORTS: CatalogOption<ReadingSort>[] = [
  { label: "Recently added", value: "recent" },
  { label: "A–Z", value: "title" },
  { label: "Author", value: "author" },
  { label: "Rating", value: "rating" },
];

export default function ReadingListScreen() {
  const router = useRouter();
  const { readingList, ready } = useLibraryReadingList();
  const { showWarning } = useLibraryUiStatus();
  const { settings, update: updateSettings } = useSettings();

  const filters = useMemo<CatalogOption<string>[]>(() => {
    const genres = [
      ...new Set(readingList.map((book) => book.genre).filter(Boolean)),
    ].sort();
    return [
      { label: "All", value: "all" },
      ...genres.map((value) => ({ label: value, value })),
    ];
  }, [readingList]);
  const genre = filters.some((option) => option.value === settings.savedCatalogFilter)
    ? settings.savedCatalogFilter
    : "all";
  const sort = SORTS.some((option) => option.value === settings.savedCatalogSort)
    ? (settings.savedCatalogSort as ReadingSort)
    : "recent";

  const books = useMemo(() => {
    const filtered = readingList.filter(
      (book) => genre === "all" || book.genre === genre,
    );
    return filtered.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "author") return a.author.localeCompare(b.author);
      if (sort === "rating") return (b.rating ?? -1) - (a.rating ?? -1);
      return b.addedAt - a.addedAt;
    });
  }, [genre, readingList, sort]);

  const openBook = useCallback(
    (book: LibraryBook) => router.push(detailParams(book) as any),
    [router],
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <CatalogToolbar
        filterLabel="Category"
        filters={filters}
        selectedFilter={genre}
        onFilter={(value) =>
          void updateSettings({ savedCatalogFilter: value }).catch((cause) =>
            showWarning(
              `Could not save saved-list filter: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
          )
        }
        sorts={SORTS}
        selectedSort={sort}
        onSort={(value) =>
          void updateSettings({ savedCatalogSort: value }).catch((cause) =>
            showWarning(
              `Could not save saved-list sort: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
          )
        }
        sortLabel="Sort by"
      />
      {!ready ? (
        <BookGridSkeleton />
      ) : books.length ? (
        <BookGrid books={books} onPressBook={openBook} />
      ) : (
        <View className="flex-1 items-center justify-center px-8 pb-16">
          {readingList.length ? (
            <Text className="text-center text-sm" style={{ color: colors.textMuted }}>
              No books match this category.
            </Text>
          ) : (
            <View className="w-32 items-center gap-3">
              <Feather name="bookmark" size={42} color={colors.textMuted} />
              <Text className="text-center text-sm leading-5" style={{ color: colors.textMuted }}>
                Books you save will appear here.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
