import MeetingScreen from "./MeetingScreen";

export const metadata = { title: "Нарада" };
export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingScreen id={id} />;
}
