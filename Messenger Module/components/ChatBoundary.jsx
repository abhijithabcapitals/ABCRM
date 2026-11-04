import { Component } from "react";

// Keeps a chat failure from reaching the page around it. Shows `fallback` instead of the failed part.
export default class ChatBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Messenger failed", error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
