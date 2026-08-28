import { RecordScreen } from "@/components/screens";

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecordScreen recordId={id} />;
}
