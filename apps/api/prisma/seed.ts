import { PrismaClient } from "@prisma/client";
import { formatReference } from "@resident/shared";

const prisma = new PrismaClient();

const day = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);
const daysAhead = (n: number) => new Date(Date.now() + n * day);

/**
 * Seed households. Emails intentionally use @riverbend.example so nothing here
 * can be mistaken for a real person's address if the demo data is exported.
 */
const HOUSEHOLDS = [
  {
    firstName: "Dana",
    lastName: "Whitfield",
    email: "dana.whitfield@riverbend.example",
    phone: "(555) 010-2288",
    serviceAddress: "418 Cedar Hollow Lane",
    zip: "55044",
    ward: 2,
    householdSize: 4,
    parcelId: "27-118-4402",
  },
  {
    firstName: "Marcus",
    lastName: "Oyelaran",
    email: "marcus.oyelaran@riverbend.example",
    phone: "(555) 010-7741",
    serviceAddress: "92 Millrace Court",
    zip: "55044",
    ward: 1,
    householdSize: 2,
    parcelId: "27-118-1109",
  },
  {
    firstName: "Priya",
    lastName: "Raghunathan",
    email: "priya.raghunathan@riverbend.example",
    phone: "(555) 010-3355",
    serviceAddress: "1207 Quarry Ridge Drive",
    zip: "55045",
    ward: 3,
    householdSize: 3,
    parcelId: "27-119-2277",
  },
  {
    firstName: "Eleanor",
    lastName: "Kaminski",
    email: "eleanor.kaminski@riverbend.example",
    phone: "(555) 010-9012",
    serviceAddress: "55 Founders Square, Apt 3B",
    zip: "55044",
    ward: 1,
    householdSize: 1,
    parcelId: "27-118-0055",
  },
  {
    firstName: "Tobias",
    lastName: "Brandt",
    email: "tobias.brandt@riverbend.example",
    phone: "(555) 010-4460",
    serviceAddress: "3390 North Levee Road",
    zip: "55046",
    ward: 4,
    householdSize: 5,
    parcelId: "27-120-8833",
  },
];

const PROGRAMS = [
  {
    code: "REC-101",
    name: "Learn to Swim — Level 2",
    category: "aquatics",
    season: "Fall 2026",
    description: "Six-week progressive swim instruction for children comfortable in shallow water.",
    location: "Riverbend Aquatic Center",
    schedule: "Tuesdays & Thursdays, 4:30–5:15 PM",
    ageMin: 5,
    ageMax: 10,
    capacity: 18,
    enrolled: 11,
    feeCents: 8500,
  },
  {
    code: "CAMP-204",
    name: "Riverbank Explorers Day Camp",
    category: "youth_camp",
    season: "Summer 2026",
    description: "Outdoor day camp along the river: canoeing, naturalist walks, and water-quality science.",
    location: "Levee Park Pavilion",
    schedule: "Weekdays, 8:00 AM–3:30 PM",
    ageMin: 8,
    ageMax: 13,
    capacity: 40,
    enrolled: 37,
    feeCents: 24500,
  },
  {
    code: "SEN-310",
    name: "Senior Center Congregate Lunch",
    category: "senior",
    season: "Year-round",
    description: "Weekday hot lunch with transportation available on request. Suggested donation only.",
    location: "Riverbend Senior Center",
    schedule: "Weekdays, 11:30 AM",
    ageMin: 60,
    ageMax: 120,
    capacity: 60,
    enrolled: 44,
    feeCents: 0,
  },
  {
    code: "ART-115",
    name: "Community Pottery Studio",
    category: "arts",
    season: "Fall 2026",
    description: "Open studio with wheel access, plus one guided session per week. Clay included.",
    location: "Old Waterworks Arts Building",
    schedule: "Wednesdays, 6:00–8:30 PM",
    ageMin: 16,
    ageMax: 120,
    capacity: 14,
    enrolled: 14,
    feeCents: 16000,
  },
  {
    code: "SPT-402",
    name: "Youth Fall Soccer League",
    category: "sports",
    season: "Fall 2026",
    description: "Recreational league, eight-game season plus a jamboree weekend. Volunteer coaches needed.",
    location: "Quarry Ridge Fields",
    schedule: "Saturdays, 9:00 AM–12:00 PM",
    ageMin: 6,
    ageMax: 12,
    capacity: 90,
    enrolled: 61,
    feeCents: 6500,
  },
  {
    code: "REC-220",
    name: "Adult Open Gym Pickleball",
    category: "recreation",
    season: "Year-round",
    description: "Drop-in play, four courts, paddles available to borrow.",
    location: "Riverbend Community Center",
    schedule: "Mon/Wed/Fri, 7:00–10:00 AM",
    ageMin: 18,
    ageMax: 120,
    capacity: 32,
    enrolled: 19,
    feeCents: 3000,
  },
];

async function main() {
  console.log("Seeding City of Riverbend demo data…");

  // Idempotent: clear in FK-safe order so re-seeding is not a merge conflict.
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.paymentIntent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.programRegistration.deleteMany(),
    prisma.program.deleteMany(),
    prisma.assistanceCase.deleteMany(),
    prisma.codeCase.deleteMany(),
    prisma.citation.deleteMany(),
    prisma.serviceRequestUpdate.deleteMany(),
    prisma.serviceRequest.deleteMany(),
    prisma.inspection.deleteMany(),
    prisma.permit.deleteMany(),
    prisma.taxBill.deleteMany(),
    prisma.utilityStatement.deleteMany(),
    prisma.utilityAccount.deleteMany(),
  ]);
  await prisma.user.updateMany({ data: { residentId: null } });
  await prisma.resident.deleteMany();

  const residents = [];
  for (const [index, h] of HOUSEHOLDS.entries()) {
    const resident = await prisma.resident.create({
      data: {
        accountNumber: formatReference("RB", index + 1001, 2026),
        firstName: h.firstName,
        lastName: h.lastName,
        email: h.email,
        phone: h.phone,
        serviceAddress: h.serviceAddress,
        serviceZip: h.zip,
        mailingAddress: h.serviceAddress,
        mailingCity: "Riverbend",
        mailingState: "MN",
        mailingZip: h.zip,
        parcelId: h.parcelId,
        ward: h.ward,
        householdSize: h.householdSize,
        moveInDate: daysAgo(400 + index * 260),
        alertTopics: ["water_main", "snow_emergency"],
      },
    });
    residents.push(resident);

    // Utility account with three billing periods; the newest is still due.
    const account = await prisma.utilityAccount.create({
      data: {
        accountNumber: `${resident.accountNumber}-U1`,
        residentId: resident.id,
        serviceAddress: h.serviceAddress,
        services: ["water", "sewer", "trash", "recycling", "stormwater"],
        meterId: `M${420000 + index * 37}`,
        autopayEnabled: index === 1,
        openedAt: daysAgo(400 + index * 260),
      },
    });

    for (let period = 2; period >= 0; period--) {
      const periodEnd = daysAgo(period * 30 + 2);
      const periodStart = new Date(periodEnd.getTime() - 30 * day);
      const gallons = 2600 + index * 420 + period * 180;
      const waterCents = Math.round(gallons * 1.24);
      const sewerCents = Math.round(waterCents * 0.78);
      const trashCents = 2400;
      const stormwaterCents = 850;
      const overdue = period === 0 && index === 0;
      const lateFeeCents = overdue ? 1200 : 0;
      const amountCents = waterCents + sewerCents + trashCents + stormwaterCents + lateFeeCents;
      const settled = period > 0;

      await prisma.utilityStatement.create({
        data: {
          statementNumber: formatReference("ST", index * 10 + (3 - period), 2026),
          utilityAccountId: account.id,
          periodStart,
          periodEnd,
          dueDate: new Date(periodEnd.getTime() + 21 * day),
          waterGallons: gallons,
          waterCents,
          sewerCents,
          trashCents,
          stormwaterCents,
          lateFeeCents,
          amountCents,
          paidCents: settled ? amountCents : 0,
          status: settled ? "paid" : overdue ? "overdue" : "due",
          paidAt: settled ? new Date(periodEnd.getTime() + 12 * day) : null,
        },
      });
    }

    await prisma.taxBill.create({
      data: {
        billNumber: formatReference("TX", index + 1, 2026),
        residentId: resident.id,
        parcelId: h.parcelId,
        taxYear: 2026,
        assessedValueCents: 28_500_000 + index * 4_200_000,
        amountCents: 412_000 + index * 61_000,
        paidCents: index % 2 === 0 ? 206_000 + index * 30_500 : 0,
        dueDate: daysAhead(45),
        status: index % 2 === 0 ? "partial" : "due",
        exemptions: index === 3 ? ["homestead", "senior_deferral"] : ["homestead"],
      },
    });
  }

  // ── Permits ───────────────────────────────────────────────────────────────
  const deckPermit = await prisma.permit.create({
    data: {
      permitNumber: formatReference("PM", 1, 2026),
      residentId: residents[0].id,
      type: "building",
      status: "under_review",
      address: residents[0].serviceAddress,
      description: "Replace rear deck, 14x20, attached to existing ledger. Pressure-treated framing, composite decking.",
      contractorName: "Northline Carpentry LLC",
      estimatedValueCents: 1_850_000,
      feeCents: 24500,
      submittedAt: daysAgo(9),
    },
  });
  await prisma.inspection.create({
    data: {
      permitId: deckPermit.id,
      type: "footing",
      scheduledFor: daysAhead(6),
      inspectorName: "R. Alvarez",
      inspectorNotes:
        "Applicant's site plan shows footings 8 ft on centre; verify depth below frost line before pour. Neighbour at 420 has an unrelated open drainage complaint — do not conflate.",
    },
  });

  await prisma.permit.create({
    data: {
      permitNumber: formatReference("PM", 2, 2026),
      residentId: residents[2].id,
      type: "business_license",
      status: "issued",
      address: "18 Front Street, Suite 2",
      description: "Retail bakery, seating for 12. Annual renewal.",
      estimatedValueCents: 0,
      feeCents: 15000,
      feePaid: true,
      submittedAt: daysAgo(120),
      decidedAt: daysAgo(112),
      decidedBy: "permits@riverbend.example",
      issuedAt: daysAgo(112),
      expiresAt: daysAhead(245),
    },
  });

  await prisma.permit.create({
    data: {
      permitNumber: formatReference("PM", 3, 2026),
      residentId: residents[4].id,
      type: "fence",
      status: "needs_info",
      address: residents[4].serviceAddress,
      description: "Six-foot privacy fence along north and east property lines.",
      feeCents: 6500,
      submittedAt: daysAgo(15),
      decidedAt: daysAgo(11),
      decidedBy: "permits@riverbend.example",
      decisionNote:
        "Need a survey or plat showing the north line — the sketch puts the fence within the 10 ft drainage easement.",
    },
  });

  // ── 311 service requests ──────────────────────────────────────────────────
  const requests = [
    {
      residentId: residents[0].id,
      category: "pothole",
      description: "Deep pothole in the northbound lane just past the Cedar Hollow stop sign. Has taken out at least one tire.",
      address: "Cedar Hollow Lane at Birch Street",
      status: "in_progress",
      priority: "high",
      assignedCrew: "Street Maintenance — Crew 2",
      openedAt: daysAgo(6),
      dueBy: daysAhead(1),
    },
    {
      residentId: residents[1].id,
      category: "streetlight_out",
      description: "Two streetlights out on the west side of Millrace Court, dark since the storm.",
      address: "90–100 Millrace Court",
      status: "acknowledged",
      priority: "normal",
      openedAt: daysAgo(3),
      dueBy: daysAhead(4),
    },
    {
      residentId: residents[2].id,
      category: "missed_collection",
      description: "Recycling was not collected on Tuesday; cart was out by 6 AM.",
      address: "1207 Quarry Ridge Drive",
      status: "closed",
      priority: "normal",
      openedAt: daysAgo(12),
      closedAt: daysAgo(11),
      closureNote: "Collected on the Thursday makeup run. Route sheet corrected.",
    },
    {
      residentId: residents[4].id,
      category: "downed_tree",
      description: "Large silver maple limb down across the shoulder, partially blocking the bike lane.",
      address: "3390 North Levee Road",
      status: "scheduled",
      priority: "high",
      assignedCrew: "Forestry",
      openedAt: daysAgo(2),
      dueBy: daysAhead(1),
    },
    {
      residentId: residents[3].id,
      category: "graffiti",
      description: "Tagging on the Founders Square utility box, facing the plaza.",
      address: "55 Founders Square",
      status: "open",
      priority: "low",
      openedAt: daysAgo(1),
      dueBy: daysAhead(9),
    },
  ];

  for (const [index, r] of requests.entries()) {
    const resident = residents.find((res) => res.id === r.residentId)!;
    await prisma.serviceRequest.create({
      data: {
        requestNumber: formatReference("SR", index + 1, 2026),
        residentId: r.residentId,
        reportedBy: resident.email,
        category: r.category,
        description: r.description,
        address: r.address,
        status: r.status,
        priority: r.priority,
        assignedCrew: r.assignedCrew ?? null,
        openedAt: r.openedAt,
        dueBy: r.dueBy ?? null,
        closedAt: r.closedAt ?? null,
        closureNote: r.closureNote ?? null,
        updates: {
          create: [
            { note: "Reported through the resident portal.", author: resident.email, statusTo: "open", createdAt: r.openedAt },
            ...(r.status !== "open"
              ? [
                  {
                    note: r.closureNote ?? `Assigned to ${r.assignedCrew ?? "dispatch"}.`,
                    author: "dispatch@riverbend.example",
                    statusFrom: "open",
                    statusTo: r.status,
                    createdAt: new Date(r.openedAt.getTime() + day),
                  },
                ]
              : []),
          ],
        },
      },
    });
  }

  // ── Citations ─────────────────────────────────────────────────────────────
  await prisma.citation.createMany({
    data: [
      {
        citationNumber: formatReference("CT", 1, 2026),
        residentId: residents[0].id,
        plate: "MN 7KLQ42",
        violationCode: "9-4-2",
        description: "Parked in a posted snow emergency route during a declared event",
        location: "400 block, Cedar Hollow Lane",
        issuedAt: daysAgo(11),
        dueDate: daysAhead(19),
        amountCents: 6000,
        status: "unpaid",
      },
      {
        citationNumber: formatReference("CT", 2, 2026),
        residentId: residents[1].id,
        plate: "MN 3XRB88",
        violationCode: "9-2-7",
        description: "Expired meter, Front Street bay 14",
        location: "Front Street",
        issuedAt: daysAgo(30),
        dueDate: daysAgo(1),
        amountCents: 2500,
        paidCents: 2500,
        status: "paid",
      },
      {
        citationNumber: formatReference("CT", 3, 2026),
        residentId: residents[4].id,
        violationCode: "6-1-3",
        description: "Refuse containers left at the curb more than 24 hours after collection",
        location: "3390 North Levee Road",
        issuedAt: daysAgo(5),
        dueDate: daysAhead(25),
        amountCents: 7500,
        status: "unpaid",
      },
    ],
  });

  // ── Sensitive datasets ────────────────────────────────────────────────────
  await prisma.assistanceCase.createMany({
    data: [
      {
        caseNumber: formatReference("AS", 1, 2026),
        residentId: residents[3].id,
        program: "senior_discount",
        status: "approved",
        householdIncomeCents: 2_640_000,
        householdSize: 1,
        benefitCents: 1800,
        caseworkerName: "L. Fontaine",
        caseworkerNotes:
          "Fixed income, verified via SSA award letter. Prefers paper billing — do not enrol in autopay without a phone call first.",
        openedAt: daysAgo(210),
        reviewDate: daysAhead(155),
      },
      {
        caseNumber: formatReference("AS", 2, 2026),
        residentId: residents[4].id,
        program: "utility_assistance",
        status: "pending_documentation",
        householdIncomeCents: 5_180_000,
        householdSize: 5,
        benefitCents: 0,
        caseworkerName: "L. Fontaine",
        caseworkerNotes:
          "Awaiting two most recent pay stubs. Household had a job loss in the last quarter; flagged for expedited review once documents land.",
        openedAt: daysAgo(24),
        reviewDate: daysAhead(6),
      },
    ],
  });

  await prisma.codeCase.createMany({
    data: [
      {
        caseNumber: formatReference("CE", 1, 2026),
        address: residents[4].serviceAddress,
        residentId: residents[4].id,
        violationType: "outdoor_storage",
        description: "Inoperable vehicle and accumulated materials visible from the right-of-way.",
        status: "notice_sent",
        openedAt: daysAgo(19),
        inspectorName: "R. Alvarez",
        inspectorNotes:
          "Second complaint this season, both from the same neighbour. Owner was cooperative on site and asked for time to arrange a haul-away; recommend abatement extension rather than citation.",
        hearingDate: daysAhead(21),
        fineCents: 0,
      },
      {
        caseNumber: formatReference("CE", 2, 2026),
        address: "18 Front Street, Suite 2",
        residentId: residents[2].id,
        violationType: "sign_without_permit",
        description: "A-frame sidewalk sign placed outside the permitted envelope.",
        status: "abated",
        openedAt: daysAgo(64),
        inspectorName: "D. Kwan",
        inspectorNotes: "Sign relocated within 48 hours of notice. No further action.",
        fineCents: 0,
      },
    ],
  });

  // ── Program catalog ───────────────────────────────────────────────────────
  for (const p of PROGRAMS) {
    await prisma.program.create({
      data: {
        ...p,
        registrationOpens: daysAgo(20),
        registrationCloses: daysAhead(35),
      },
    });
  }

  const soccer = await prisma.program.findUnique({ where: { code: "SPT-402" } });
  if (soccer) {
    await prisma.programRegistration.create({
      data: {
        confirmationRef: formatReference("REG", 1, 2026),
        programId: soccer.id,
        residentId: residents[0].id,
        participantName: "Noah Whitfield",
        participantAge: 9,
        feeCents: soccer.feeCents,
        status: "registered_unpaid",
      },
    });
  }

  const counts = {
    residents: await prisma.resident.count(),
    statements: await prisma.utilityStatement.count(),
    permits: await prisma.permit.count(),
    requests: await prisma.serviceRequest.count(),
    citations: await prisma.citation.count(),
    programs: await prisma.program.count(),
    assistanceCases: await prisma.assistanceCase.count(),
    codeCases: await prisma.codeCase.count(),
  };
  console.log("Seed complete:", counts);
  console.log(
    "\nDemo households (link an Okta user by matching email, or use dev login):\n" +
      HOUSEHOLDS.map((h) => `  ${h.email}`).join("\n")
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
