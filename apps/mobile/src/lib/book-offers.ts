import type { BookMetadata, BookOffer } from '@tomeio/domain';

export function primaryBookOffer(book: Pick<BookMetadata, 'offers'>): BookOffer | undefined {
  return book.offers?.find((offer) => offer.price) ?? book.offers?.[0];
}

export function formatBookOffer(offer: BookOffer | undefined): string | undefined {
  if (!offer) return undefined;
  if (offer.availability === 'free') return 'Free';
  if (!offer.price) return offer.availability === 'preorder' ? 'Pre-order' : undefined;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: offer.price.currency,
      maximumFractionDigits: 2,
    }).format(offer.price.amount);
  } catch {
    return `${offer.price.currency} ${offer.price.amount.toFixed(2)}`;
  }
}

export function bookPriceLabel(book: Pick<BookMetadata, 'offers'>): string | undefined {
  return formatBookOffer(primaryBookOffer(book));
}

export function bookSourceUrl(
  book: Pick<BookMetadata, 'offers' | 'infoUrl'>
): string | undefined {
  return primaryBookOffer(book)?.url ?? book.infoUrl;
}
