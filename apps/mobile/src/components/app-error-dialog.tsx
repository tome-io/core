import { AppTextSheet } from './app-text-sheet';

export function AppErrorDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string | null;
  onClose: () => void;
}) {
  return (
    <AppTextSheet
      visible={message != null}
      title={title}
      text={message ?? ''}
      onClose={onClose}
      muted
    />
  );
}
