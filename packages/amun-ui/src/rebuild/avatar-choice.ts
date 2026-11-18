// The picture the captain chose for an agent on Edit Agent. Kept by Amun on
// this Mac, never in the Firstmate home.
import { useSyncExternalStore } from "react";

export const AVATARS = [
  "giraffe",
  "gorilla",
  "hyena",
  "kangaroo",
  "koala",
  "leopard",
  "lion",
  "orca",
  "panda",
  "penguin",
  "polarbear",
  "redpanda",
  "rhinoceros",
  "toucan",
  "turtle",
  "wolf",
  "zebra",
] as const;

const key = (role: string) => "amun.avatar." + role.toLowerCase();
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function chosenAvatar(role: string): string | null {
  const value = storage()?.getItem(key(role)) ?? null;
  return value && (AVATARS as readonly string[]).includes(value) ? value : null;
}

export function chooseAvatar(role: string, avatar: string | null): void {
  const store = storage();
  if (!store) return;
  if (avatar) store.setItem(key(role), avatar);
  else store.removeItem(key(role));
  for (const listener of listeners) listener();
}

export function useChosenAvatar(role: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => chosenAvatar(role),
    () => null,
  );
}
