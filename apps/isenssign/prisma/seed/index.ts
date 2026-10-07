import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new (PrismaClient as any)({ adapter });

  try {
    console.log("Seeding database...");

    // 1. Account
    const account = await prisma.account.upsert({
      where: { id: "seed-account-001" },
      update: {},
      create: {
        id: "seed-account-001",
        name: "아이센스 F&B",
        timezone: "Asia/Seoul",
        locale: "ko",
      },
    });
    console.log(`Account created: ${account.name}`);

    // 2. Admin User
    const passwordHash = await hash("admin1234", 12);
    const adminUser = await prisma.user.upsert({
      where: { email: "admin@isens.co.kr" },
      update: {},
      create: {
        id: "seed-user-001",
        email: "admin@isens.co.kr",
        firstName: "관리자",
        passwordHash,
        role: "ADMIN",
        accountId: account.id,
      },
    });
    console.log(`Admin user created: ${adminUser.email}`);

    // 3. Default TemplateFolder
    const defaultFolder = await prisma.templateFolder.upsert({
      where: { id: "seed-folder-001" },
      update: {},
      create: {
        id: "seed-folder-001",
        name: "Default",
        accountId: account.id,
        authorId: adminUser.id,
      },
    });
    console.log(`Template folder created: ${defaultFolder.name}`);

    // 4. AccountConfig
    await prisma.accountConfig.upsert({
      where: { accountId: account.id },
      update: {},
      create: {
        accountId: account.id,
        storageProvider: "local",
      },
    });
    console.log("Account config created");

    // 5. Sample Templates
    const templateData = [
      {
        id: "seed-template-001",
        name: "근로계약서",
        schema: JSON.stringify([
          { name: "employee_name", type: "text", label: "성명", required: true },
          { name: "start_date", type: "date", label: "근무시작일", required: true },
          { name: "position", type: "text", label: "직위", required: false },
          { name: "salary", type: "number", label: "급여", required: true },
          { name: "signature", type: "signature", label: "서명", required: true },
        ]),
      },
      {
        id: "seed-template-002",
        name: "비밀유지서약서",
        schema: JSON.stringify([
          { name: "signer_name", type: "text", label: "서약자 성명", required: true },
          { name: "department", type: "text", label: "부서", required: false },
          { name: "effective_date", type: "date", label: "효력발생일", required: true },
          { name: "signature", type: "signature", label: "서명", required: true },
        ]),
      },
      {
        id: "seed-template-003",
        name: "입사지원서",
        schema: JSON.stringify([
          { name: "applicant_name", type: "text", label: "지원자 성명", required: true },
          { name: "phone", type: "text", label: "연락처", required: true },
          { name: "email", type: "text", label: "이메일", required: true },
          { name: "desired_position", type: "text", label: "희망직무", required: true },
          { name: "experience", type: "text", label: "경력사항", required: false },
        ]),
      },
    ];

    const templates = [];
    for (const tmpl of templateData) {
      const template = await prisma.template.upsert({
        where: { id: tmpl.id },
        update: {},
        create: {
          id: tmpl.id,
          name: tmpl.name,
          schema: tmpl.schema,
          accountId: account.id,
          authorId: adminUser.id,
          folderId: defaultFolder.id,
        },
      });
      templates.push(template);
      console.log(`Template created: ${template.name}`);
    }

    // 6. Sample Submission with 2 Submitters (for 근로계약서)
    const submission = await prisma.submission.upsert({
      where: { id: "seed-submission-001" },
      update: {},
      create: {
        id: "seed-submission-001",
        slug: "seed-submission-slug-001",
        source: "WEB",
        submitterOrder: "SEQUENTIAL",
        status: "PENDING",
        accountId: account.id,
        templateId: templates[0].id,
        createdById: adminUser.id,
      },
    });
    console.log(`Submission created: ${submission.id}`);

    // Submitter 1 - HR Manager (sender)
    await prisma.submitter.upsert({
      where: { id: "seed-submitter-001" },
      update: {},
      create: {
        id: "seed-submitter-001",
        slug: "seed-submitter-slug-001",
        email: "hr@isens.co.kr",
        name: "김인사",
        role: "HR 담당자",
        status: "COMPLETED",
        completedAt: new Date(),
        submissionId: submission.id,
      },
    });
    console.log("Submitter 1 created: 김인사 (HR 담당자)");

    // Submitter 2 - Employee (signer)
    await prisma.submitter.upsert({
      where: { id: "seed-submitter-002" },
      update: {},
      create: {
        id: "seed-submitter-002",
        slug: "seed-submitter-slug-002",
        email: "newjoin@example.com",
        name: "박신입",
        role: "근로자",
        status: "PENDING",
        submissionId: submission.id,
      },
    });
    console.log("Submitter 2 created: 박신입 (근로자)");

    console.log("\nSeed completed successfully!");
  } catch (error) {
    console.error("Seed failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
