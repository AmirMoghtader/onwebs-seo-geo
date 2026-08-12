export const dynamic = "force-static";
import { Toaster } from "@/components/ui/sonner";
import MenuDrawer from "../components/ui/MenuDrawer";

export default function Layout({ children }: any) {
  return (
    <main className="h-[calc(100vh-46px)] overflow-hidden">
      {children}
      <Toaster />
    </main>
  );
}
