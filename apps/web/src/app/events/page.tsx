import { EventsScreen } from "@/components/screens";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ runId?: string }>;
}) {
  const { runId } = await searchParams;
  return <EventsScreen runId={runId} />;
}
