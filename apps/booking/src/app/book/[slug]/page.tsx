import { notFound } from "next/navigation";
import { findEventTypeBySlug } from "@/lib/event-types";
import BookingScreen from "@/components/BookingScreen";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function BookSlugPage({ params }: Props) {
  const { slug } = await params;
  const et = await findEventTypeBySlug(slug);
  if (!et || !et.active) notFound();
  return <BookingScreen eventTypeSlug={slug} />;
}
