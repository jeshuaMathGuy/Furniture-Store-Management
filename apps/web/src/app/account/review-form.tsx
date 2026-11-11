"use client";

import { ActionForm } from "@/components/action-form";
import { reviewAction } from "../orders/actions";

export function ReviewForm({ productId }: { productId: number }) {
  return (
    <ActionForm action={reviewAction} submitLabel="Publish review" className="mt-3 space-y-2" testId="review-form">
      <input type="hidden" name="productId" value={productId} />
      <fieldset className="flex gap-3 text-sm">
        <legend className="sr-only">Rating</legend>
        {[5, 4, 3, 2, 1].map((r) => (
          <label key={r} className="flex items-center gap-1"><input type="radio" name="rating" value={r} defaultChecked={r === 5} className="accent-[#373a34]" />{r}★</label>
        ))}
      </fieldset>
      <textarea name="comment" maxLength={500} rows={2} className="field h-auto py-2" placeholder="What do you think of it? (optional)" />
    </ActionForm>
  );
}
