// A tab that's built in a later phase: says plainly what will be here.
import { Card, Screen, T } from '@/components/ui';

export function ComingSoon({ title, what, phase }: { title: string; what: string; phase: string }) {
  return (
    <Screen>
      <T kind="title">{title}</T>
      <Card>
        <T>{what}</T>
        <T kind="small" quiet>
          Coming in {phase}.
        </T>
      </Card>
    </Screen>
  );
}
