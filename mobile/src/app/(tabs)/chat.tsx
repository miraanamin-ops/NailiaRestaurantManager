// The Chat tab: opens Chat as a full page (app/conversation.tsx). Back from that page,
// it goes on to the Inbox (lib/chat-nav.ts). Buttons elsewhere ("Answer in Chat", a
// report's action, "Import a list") open the page directly with what they carry.
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { usePalette } from '@/components/ui';
import { leftChat } from '@/lib/chat-nav';

export default function ChatTab() {
  const c = usePalette();
  useFocusEffect(
    useCallback(() => {
      if (leftChat.take()) {
        router.navigate('/inbox');
        return;
      }
      router.push('/conversation');
    }, []),
  );
  return <View style={{ flex: 1, backgroundColor: c.background }} />;
}
