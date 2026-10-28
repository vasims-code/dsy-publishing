import { Toaster } from "@/components/ui/sonner";
import { AppProvider, useApp } from "@/state/AppContext";
import { BrowserFrame } from "@/shell/BrowserFrame";

function Shell() {
  const { ready, theme } = useApp();
  if (!ready) return <div className="h-screen w-screen bg-background" />;
  return (
    <>
      <BrowserFrame />
      <Toaster position="bottom-right" theme={theme} />
    </>
  );
}

function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

export default App;
