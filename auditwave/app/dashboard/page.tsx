import { Suspense } from "react";
import DashboardPage from "../../components/DashboardPage";

export default function Page() {
  return (
    <Suspense>
      <DashboardPage />
    </Suspense>
  );
}
