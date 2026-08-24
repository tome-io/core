let activePickers = 0;

export function beginFolderPicker(): void {
  activePickers += 1;
}

export function endFolderPicker(): void {
  activePickers = Math.max(0, activePickers - 1);
}

export function isFolderPickerActive(): boolean {
  return activePickers > 0;
}
