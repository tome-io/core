import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { colors } from '@/components/app-ui';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: '\u00a0',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, encoded: string) => {
      if (encoded.startsWith('#')) {
        const hexadecimal = encoded[1]?.toLowerCase() === 'x';
        const codePoint = Number.parseInt(encoded.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return NAMED_ENTITIES[encoded.toLowerCase()] ?? entity;
    }
  );
}

export function normalizeDescription(value: string): string {
  return decodeEntities(
    value
      .replace(/\r\n?/g, '\n')
      .replace(/<\s*(strong|b)(?:\s[^>]*)?>/gi, '**')
      .replace(/<\s*\/\s*(strong|b)\s*>/gi, '**')
      .replace(/<\s*(em|i)(?:\s[^>]*)?>/gi, '*')
      .replace(/<\s*\/\s*(em|i)\s*>/gi, '*')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*li(?:\s[^>]*)?>/gi, '• ')
      .replace(/<\s*\/\s*li\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|blockquote|h[1-6])\s*>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function descriptionPlainText(value: string): string {
  return normalizeDescription(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*\*|___)(.+?)\1/gs, '$2')
    .replace(/(\*\*|__)(.+?)\1/gs, '$2')
    .replace(/([*_])([^\n]+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1');
}

function markdownChildren(value: string): ReactNode[] {
  const tokens = value.split(
    /(\*\*\*[^*]+?\*\*\*|___[^_]+?___|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\n]+?\*|_[^_\n]+?_)/g
  );

  return tokens.filter(Boolean).map((token, index) => {
    const boldItalic =
      (token.startsWith('***') && token.endsWith('***')) ||
      (token.startsWith('___') && token.endsWith('___'));
    const bold =
      !boldItalic &&
      ((token.startsWith('**') && token.endsWith('**')) ||
        (token.startsWith('__') && token.endsWith('__')));
    const italic =
      !boldItalic &&
      !bold &&
      ((token.startsWith('*') && token.endsWith('*')) ||
        (token.startsWith('_') && token.endsWith('_')));
    const markerLength = boldItalic ? 3 : bold ? 2 : italic ? 1 : 0;

    return (
      <Text
        key={`${index}:${token.slice(0, 12)}`}
        style={
          boldItalic
            ? { fontStyle: 'italic', fontWeight: '700' }
            : bold
              ? { fontWeight: '700' }
              : italic
                ? { fontStyle: 'italic' }
                : undefined
        }
      >
        {markerLength ? token.slice(markerLength, -markerLength) : token}
      </Text>
    );
  });
}

export function DescriptionText({
  value,
  numberOfLines,
  className,
  style,
}: {
  value: string;
  numberOfLines?: number;
  className?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      className={className}
      style={[{ color: colors.text }, style]}
    >
      {markdownChildren(normalizeDescription(value))}
    </Text>
  );
}
