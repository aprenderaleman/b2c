import { redirect } from "next/navigation";

// Legacy alias: the admin login is now the unified /login page.
// This route preserves old bookmarks / links that still point here.
export default function AdminLoginAlias() {
  redirect("/login?next=%2Fadmin");
}
