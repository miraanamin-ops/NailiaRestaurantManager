// Chat is a full page (app/conversation.tsx) over the tabs. The Chat tab only opens it;
// coming back from it (the back button or a swipe) onto the Chat tab, the tab hands over
// to the Inbox, the owner's call (15 Nov). This remembers that the page was just left:
// only for a moment, so opening Chat from the Inbox and coming back doesn't count later.
let leftAt = 0;
export const leftChat = {
  mark() {
    leftAt = Date.now();
  },
  take() {
    const just = Date.now() - leftAt < 1500;
    leftAt = 0;
    return just;
  },
};
