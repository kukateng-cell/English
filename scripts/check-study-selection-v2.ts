/** 新揀詞政策的 PostgreSQL 回歸；只建立及清理隨機測試帳戶。 */
import dotenv from "dotenv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CATALOG_CATEGORIES } from "../src/lib/catalog/taxonomy";
import { withCurrentCatalogWord } from "../src/lib/catalog/runtime";
import type { PublicStreamResponse, StudyStreamActionInput } from "../src/lib/study-stream/contracts";
dotenv.config({ path: ".env.local", quiet: true });
async function main() {
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.DATABASE_URL ?? "").hostname)) throw new Error("只允許本機測試庫");
  const { prisma } = await import("../src/lib/prisma");
  const { getOrCreateStudyStream, applyStudyStreamAction } = await import("../src/lib/study-stream/server");
  const users: string[] = [];
  const scope = { mode: "unit", level: "A1", category: CATALOG_CATEGORIES[0] };
  async function action(stream: PublicStreamResponse, actionKind: StudyStreamActionInput["actionKind"], payload: StudyStreamActionInput["payload"]) {
    assert.ok(stream.item);
    const input: StudyStreamActionInput = { flowVersion: "v2", studySessionId: stream.session.id, streamItemId: stream.item.streamItemId,
      itemCredential: stream.item.itemCredential, clientKnownRevision: stream.item.clientRevision, operationId: randomUUID(), actionKind, payload };
    return { input, result: await applyStudyStreamAction(users[0], input) };
  }
  try {
    const user = await prisma.user.create({ data: { accountName: `selection-${randomUUID()}`, passwordHash: "not-a-login-password", mustChangePassword: false } });
    users.push(user.id);
    let stream = await getOrCreateStudyStream(user.id, scope);
    const seen = new Set<string>();
    for (let i=0; i<5; i++) {
      assert.equal(stream.item?.kind, "LEARNING_CARD");
      assert.equal(stream.item?.policyVersion, "retrieval-v2");
      assert.ok(!seen.has(stream.item!.prompt)); seen.add(stream.item!.prompt);
      await action(stream, "REVEAL", {});
      stream = await getOrCreateStudyStream(user.id, scope);
      await action(stream, "SELF_RATING", { selfRating: "selfRecalled" });
      stream = await getOrCreateStudyStream(user.id, scope);
    }
    assert.equal(stream.item, null);
    assert.equal(stream.availability?.state, "waiting");
    assert.equal(await prisma.evidenceObligation.count({ where: { userId: user.id, status: { in: ["PENDING", "LEASED"] } } }),5);
    assert.equal(await prisma.review.count({where:{userId:user.id}}),0);
    const past = new Date(Date.now()-1200000);
    await prisma.evidenceObligation.updateMany({where:{userId:user.id},data:{eligibleAt:past}});
    await prisma.studyStreamItem.updateMany({where:{session:{userId:user.id}},data:{revealedAt:past,usedAt:past,feedbackAcknowledgedAt:past}});
    stream = await getOrCreateStudyStream(user.id,scope);
    assert.equal(stream.item?.kind,"OBJECTIVE_PROBE");
    const snapshot = await prisma.studyStreamItem.findUniqueOrThrow({where:{id:stream.item!.streamItemId},include:{objectiveQuestionSnapshot:true}});
    const answer = await action(stream,"OBJECTIVE_ANSWER",{selectedOptionId:snapshot.objectiveQuestionSnapshot!.correctOptionId});
    await applyStudyStreamAction(user.id,answer.input);
    assert.equal(await prisma.reviewEvent.count({where:{userId:user.id,eventKind:"REVIEW"}}),1);
    stream = await getOrCreateStudyStream(user.id,scope);
    await action(stream,"FEEDBACK_ACK",{});
    // 未到期單元不以已學詞無限填充；repetitions=0 防止解鎖其他單元影響 fixture。
    const user2=await prisma.user.create({data:{accountName:`selection-${randomUUID()}`,passwordHash:"not-a-login-password"}});users.push(user2.id);
    const words=await prisma.word.findMany({where:withCurrentCatalogWord({level:"A1",category:scope.category}),select:{id:true,senseId:true}});
    await prisma.review.createMany({data:words.map(w=>({userId:user2.id,wordId:w.id,senseId:w.senseId,interval:1,repetitions:0,nextReviewDate:new Date(Date.now()+86400000)}))});
    const noDue=await getOrCreateStudyStream(user2.id,scope);
    assert.equal(noDue.item,null);
    const user3=await prisma.user.create({data:{accountName:`selection-${randomUUID()}`,passwordHash:"not-a-login-password"}});users.push(user3.id);
    const [unitLease,globalLease]=await Promise.all([getOrCreateStudyStream(user3.id,scope),getOrCreateStudyStream(user3.id)]);
    assert.ok(unitLease.item);assert.ok(globalLease.item);
    assert.notEqual(unitLease.item.streamItemId,globalLease.item.streamItemId);
    const unitWord=await prisma.studyStreamItem.findUniqueOrThrow({where:{id:unitLease.item.streamItemId}});
    const globalWord=await prisma.studyStreamItem.findUniqueOrThrow({where:{id:globalLease.item.streamItemId}});
    assert.notEqual(unitWord.wordId,globalWord.wordId);
    await prisma.studySession.update({where:{id:unitLease.session.id},data:{expiresAt:past}});
    const resumed=await getOrCreateStudyStream(user3.id,scope);
    assert.equal(resumed.item?.streamItemId,unitLease.item.streamItemId);
    await prisma.studyEncounter.updateMany({where:{userId:user.id},data:{acknowledgedAt:past,createdAt:past}});
    // 逾期不是已驗證；原接觸仍可直接建立後繼驗證，不先重看答案。
    await prisma.evidenceObligation.updateMany({where:{userId:user.id,status:{in:["PENDING","LEASED"]}},data:{expiresAt:new Date(Date.now()-1000)}});
    let afterExpiry=await getOrCreateStudyStream(user.id,scope);
    if (afterExpiry.item?.kind === "LEARNING_CARD") {
      assert.equal(afterExpiry.item.selectionReason,"new-word");
      await action(afterExpiry,"REVEAL",{});
      afterExpiry=await getOrCreateStudyStream(user.id,scope);
      await action(afterExpiry,"SELF_RATING",{selfRating:"selfRecalled"});
      afterExpiry=await getOrCreateStudyStream(user.id,scope);
    }
    assert.equal(afterExpiry.item?.kind,"OBJECTIVE_PROBE");
    console.log("PostgreSQL selection-v2: capacity, delay, objective replay, no fillers, concurrent scope reservations, expired-session resume, expired-work renewal passed");
  } finally {
    await prisma.user.deleteMany({where:{id:{in:users}}});
    await prisma.$disconnect();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
