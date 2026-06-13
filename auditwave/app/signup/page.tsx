import { Suspense } from "react";
import SignupPage from "../../components/SignupPage";

export default function Page() {
  return (
    <Suspense>
      <SignupPage />
    </Suspense>
  );
}
