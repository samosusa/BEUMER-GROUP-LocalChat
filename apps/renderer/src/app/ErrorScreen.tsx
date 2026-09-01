import { useRouteError } from 'react-router-dom';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/Indicators';
import { describeError } from '@/shared/api/http';

/**
 * Last line of defence. A desktop app that white-screens gives the engineer nothing to act
 * on, so this always names what failed and offers the one move that usually helps.
 */
export function ErrorScreen() {
  const error = useRouteError();

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <EmptyState
        icon="warning"
        title="LocalChat hit a problem"
        description={describeError(error)}
        action={
          <Button variant="outline" icon="refresh" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    </div>
  );
}
