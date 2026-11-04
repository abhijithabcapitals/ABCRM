# Components, phase 0

Later phases add to this list. Colours and sizes come only from `tokens.css`. Icons are drawn for this project. No Teams artwork, sounds or wording.

```
App bar (AppBar.jsx)
  variants  left column at 768px and wider; bottom row below that
  states    default, hover, current page, focus-visible, unread badge on Chats
  a11y      nav landmark, real buttons, aria-current on the open section, badge in the label
  used on   S01

Top bar (MessengerApp.jsx)
  parts     logo, product name, chat search, signed-in person's initials
  states    search empty, search with text
  a11y      labelled search input; name hidden below 768px, logo keeps its alt text
  used on   S01

Chat list (PageChatList.jsx)
  parts     New chat button, rows reused from the dock's .msgr-row styles
  states    loading skeleton, empty, no search match, error with retry, unread, long name
  a11y      real buttons, aria-current on the open chat, unread count in the label
  used on   S03

Section placeholder (SectionNote.jsx)
  purpose   says plainly what a section will hold and in which phase
  a11y      section landmark named after the section
  used on   S02, S06, S10, S16, S19
```
