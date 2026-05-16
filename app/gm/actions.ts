"use server";

import { db } from "@/db";
import { settlements } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function approveSettlement(formData: FormData) {
  const settlementId = formData.get("settlementId");
  if (typeof settlementId !== "string" || !settlementId) return;

  await db
    .update(settlements)
    .set({ status: "signed", signedAt: new Date() })
    .where(eq(settlements.id, settlementId));

  revalidatePath("/gm");
}
