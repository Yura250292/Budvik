import { Metadata } from "next";
import SimulationClient from "./SimulationClient";

export const metadata: Metadata = {
  title: "Симуляція інструментів | Budvik",
  description: "Симулюйте продуктивність інструментів — різання, шліфування, свердління. Порівнюйте інструменти на реальних матеріалах.",
};

export default function SimulationPage() {
  return <SimulationClient />;
}
