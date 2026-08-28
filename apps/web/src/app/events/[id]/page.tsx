import { EventDetailScreen } from "@/components/screens";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetailScreen eventId={id} />;
}
