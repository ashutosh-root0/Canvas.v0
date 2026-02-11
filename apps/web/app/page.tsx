import styles from "./page.module.css";
import { prisma } from "@repo/db";

export default async function Home() {
  // Push a sample user 
  await prisma.user.upsert({
    where: { email: "sample@example.com" },
    update: {}, // do nothing if already exists
    create: {
      email: "sample@example.com",
      name: "Sample User",
    },
  });

  const user = await prisma.user.findFirst();

  return (
    <div className={styles.page}>
      {user?.name ?? "No user added yet"}
    </div>
  );
}
