import { TodayView } from '@/components/today-view';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <TodayView />;
}
