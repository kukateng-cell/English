import { notFound } from "next/navigation";
import UiFixture from "./UiFixture";

export default function UiFixturePage() {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  return <UiFixture />;
}
