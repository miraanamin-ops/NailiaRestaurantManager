// Today: the owner's day at a glance. Phase 0 greets them and shows their
// restaurant; the brief, the numbers and what's waiting arrive in phase 1.
import { RefreshControl, ScrollView } from 'react-native';
import { useState } from 'react';

import { Card, Screen, T } from '@/components/ui';
import { useSession } from '@/lib/session';

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Today() {
  const { me, reloadMe } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const restaurant = me?.restaurants[0];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  async function refresh() {
    setRefreshing(true);
    await reloadMe();
    setRefreshing(false);
  }

  return (
    <Screen scroll={false}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={{ gap: 16 }}>
        <T kind="title">
          {greeting()}
          {me?.firstName ? `, ${me.firstName}` : ''}
        </T>
        <T quiet>{today}</T>
        {me ? (
          <Card accent>
            <T kind="label" quiet>
              {me.isBuilder ? `Builder · ${me.restaurants.length} restaurants` : 'Your restaurant'}
            </T>
            <T kind="heading">{restaurant?.name ?? 'No restaurant yet'}</T>
            <T quiet>Your morning brief, numbers and drafts to approve will appear here.</T>
          </Card>
        ) : (
          <Card>
            <T quiet>Loading your restaurant… Pull down to try again.</T>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
