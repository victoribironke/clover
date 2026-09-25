import BetView from "@/components/views/bet-view";

// Data comes from the panel layout (loaded once); the bet is looked up there, no fetch
const BetPage = async ({ params }: PageProps<"/bets/[id]">) => {
  const { id } = await params;
  return <BetView id={id} />;
};

export default BetPage;
