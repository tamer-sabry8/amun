import { createContext, useContext } from "react";
/** The conversation in which the captain is reviewing the PRD. */
export const ReviewOrigin = createContext<{
  areaId: string;
  chatId: string | null;
} | null>(null);
export const useReviewOrigin = () => useContext(ReviewOrigin);
