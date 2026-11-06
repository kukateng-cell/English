/** 三階段政策 PostgreSQL 回歸，只建立及清理隨機測試帳戶。 */
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
  const { getOrCreateStudyStream, applyStudyStreamAction, StudyStreamError } = await import("../src/lib/study-stream/server");
  const { createStudyStreamCredential, digestStudyStreamCredential } = await import("../src/lib/study-stream/contracts");
  const users:string[]=[];
  const fixtureWords:string[]=[];
  const scope={mode:"unit",level:"A1",category:CATALOG_CATEGORIES[0]};
  const past=new Date(Date.now()-1200000),future=new Date(Date.now()+86400000);
  async function user() {
    const u=await prisma.user.create({data:{accountName:`selection-${randomUUID()}`,passwordHash:"not-a-login-password",mustChangePassword:false}});
    users.push(u.id);return u.id;
  }
  async function action(uid:string,stream:PublicStreamResponse,actionKind:StudyStreamActionInput["actionKind"],payload:StudyStreamActionInput["payload"]) {
    assert.ok(stream.item,"動作須有項目");
    const input:StudyStreamActionInput={flowVersion:"v2",studySessionId:stream.session.id,streamItemId:stream.item.streamItemId,
      itemCredential:stream.item.itemCredential,clientKnownRevision:stream.item.clientRevision,operationId:randomUUID(),actionKind,payload};
    return {input,result:await applyStudyStreamAction(uid,input)};
  }
  async function complete(uid:string,s:PublicStreamResponse,correct:boolean,forgot=false) {
    if(s.item?.kind==="LEARNING_CARD") {
      await action(uid,s,"REVEAL",{});
      s=await getOrCreateStudyStream(uid,scope);
      const rated=await action(uid,s,"SELF_RATING",{selfRating:forgot?"selfForgot":"selfRecalled"});
      assert.equal(rated.result.response.evidenceObligation?.disposition,"accepted","兩種自評都建立初驗");
    } else {
      assert.equal(s.item?.kind,"OBJECTIVE_PROBE","預期合法題目");
      const row=await prisma.studyStreamItem.findUniqueOrThrow({where:{id:s.item!.streamItemId},include:{objectiveQuestionSnapshot:true}});
      const snapshot=row.objectiveQuestionSnapshot!;
      const options=snapshot.options as Array<{id:string}>;
      const selected=correct?snapshot.correctOptionId:options.find(o=>o.id!==snapshot.correctOptionId)!.id;
      const answer=await action(uid,s,"OBJECTIVE_ANSWER",{selectedOptionId:selected});
      const count=await prisma.reviewEvent.count({where:{userId:uid}});
      await applyStudyStreamAction(uid,answer.input);
      assert.equal(await prisma.reviewEvent.count({where:{userId:uid}}),count,"重播不重複計分");
      s=await getOrCreateStudyStream(uid,scope);
      assert.equal(s.item?.streamItemId,row.id,"feedback 必須續接");
      await action(uid,s,"FEEDBACK_ACK",{});
    }
  }
  try {
    const words=await prisma.word.findMany({where:withCurrentCatalogWord({level:"A1",category:scope.category}),select:{id:true,senseId:true}});
    assert.ok(words.length>=8,"需要至少八個正式詞作持續學習回歸");
    for(const correct of [true,false]) {
      const uid=await user(),seen=new Set<string>();let probes=0;
      for(let i=0;i<24;i++) {
        const s=await getOrCreateStudyStream(uid,scope);
        assert.ok(s.item,"前十分鐘不能卡五詞");
        assert.equal(s.item.policyVersion,"retrieval-v3");
        if(s.item.kind==="LEARNING_CARD") {assert.ok(!seen.has(s.item.prompt),"不反覆發同詞卡");seen.add(s.item.prompt);}
        else probes++;
        await complete(uid,s,correct,!correct);
        const debt=await prisma.evidenceObligation.count({where:{userId:uid,status:{in:["PENDING","LEASED"]}}});
        assert.ok(debt<=5,"初學工作上限五詞");
      }
      assert.ok(seen.size>5&&probes>5,"正誤皆可學第六詞及做初驗");
      const reviews=await prisma.review.findMany({where:{userId:uid}});
      assert.ok(reviews.length>5);
      assert.ok(reviews.every(r=>r.interval===1&&r.repetitions===(correct?1:0)),"初驗不直接拉長間隔或把錯誤算認字");
      assert.equal(await prisma.evidenceObligation.count({where:{userId:uid,kind:"REMEDIATION"}}),0,"答錯不回補救循環");
    }
    for(const size of [1,2,3]) {
      const uid=await user();
      await prisma.review.createMany({data:words.slice(size).map(w=>({userId:uid,wordId:w.id,senseId:w.senseId,repetitions:0,interval:1,nextReviewDate:future}))});
      for(let i=0;i<size*2;i++) await complete(uid,await getOrCreateStudyStream(uid,scope),false,true);
      const done=await getOrCreateStudyStream(uid,scope);
      assert.equal(done.item,null,"小詞集完成初驗後不無限循環");
      assert.equal(await prisma.evidenceObligation.count({where:{userId:uid,status:{in:["PENDING","LEASED"]}}}),0);
    }
    const full=await user();
    for(const word of words.slice(0,5)) await prisma.evidenceObligation.create({data:{userId:full,wordId:word.id,senseId:word.senseId,kind:"EVIDENCE_OBLIGATION",policyVersion:"retrieval-v3",selectionReason:"full-window-fixture",eligibleAt:past,admittedAt:past,expiresAt:new Date("9999-12-31T00:00:00Z"),sourceOperationId:randomUUID()}});
    const fullView=await getOrCreateStudyStream(full,scope);
    assert.equal(fullView.item?.kind,"OBJECTIVE_PROBE","五詞已滿時服務初驗");
    await complete(full,fullView,false);
    const afterFullWrong=await getOrCreateStudyStream(full,scope);
    assert.equal(afterFullWrong.item?.kind,"LEARNING_CARD","答錯即釋放位置，能引入第六詞");
    const fullNext=await prisma.studyStreamItem.findUniqueOrThrow({where:{id:afterFullWrong.item!.streamItemId}});
    assert.ok(!words.slice(0,5).some(w=>w.id===fullNext.wordId));

    // 推進 fixture 的到期及曝光時間，經真實 server scoring 驗證長期間隔。
    const spaced=await user();
    await prisma.review.createMany({data:words.slice(1).map(w=>({userId:spaced,wordId:w.id,senseId:w.senseId,repetitions:0,interval:1,nextReviewDate:future}))});
    await complete(spaced,await getOrCreateStudyStream(spaced,scope),true);
    await complete(spaced,await getOrCreateStudyStream(spaced,scope),true);
    for(const interval of [6,15,38,1]) {
      await prisma.review.update({where:{userId_wordId:{userId:spaced,wordId:words[0].id}},data:{nextReviewDate:past,lastReviewedAt:past}});
      await prisma.studyStreamItem.updateMany({where:{session:{userId:spaced}},data:{revealedAt:past,usedAt:past,feedbackAcknowledgedAt:past}});
      const s=await getOrCreateStudyStream(spaced,scope);assert.equal(s.item?.selectionReason,"due-review");
      await complete(spaced,s,interval!==1);
      const review=await prisma.review.findUniqueOrThrow({where:{userId_wordId:{userId:spaced,wordId:words[0].id}}});
      assert.equal(review.interval,interval,"真實 server 使用既有 SM-2 間隔");
      if(interval===1) assert.equal(review.repetitions,0);
      assert.equal((await getOrCreateStudyStream(spaced,scope)).item,null,"未到期不能同場繼續計分");
    }
    const dueUser=await user();
    await prisma.review.createMany({data:words.map(w=>({userId:dueUser,wordId:w.id,senseId:w.senseId,repetitions:0,interval:1,nextReviewDate:past}))});
    for(let i=0;i<5;i++) {
      const s=await getOrCreateStudyStream(dueUser,scope);assert.equal(s.item?.kind,"OBJECTIVE_PROBE","只有到期題不用強制休息");
      assert.equal(s.item?.selectionReason,"due-review");await complete(dueUser,s,false);
    }
    // 舊裝置在新 due target 發出後又揭示答案：拒絕受提示分數，GET 能退役原題。
    const targetView=await getOrCreateStudyStream(dueUser,scope);
    assert.equal(targetView.item?.kind,"OBJECTIVE_PROBE");
    const targetItem=await prisma.studyStreamItem.findUniqueOrThrow({where:{id:targetView.item!.streamItemId},include:{objectiveQuestionSnapshot:true}});
    const legacySession=await prisma.studySession.create({data:{userId:dueUser,queueFingerprint:randomUUID(),flowVersion:"v2",learningPolicyVersion:"retrieval-v2",mode:"global",expiresAt:future}});
    const credential=createStudyStreamCredential();
    const oldCard=await prisma.studyStreamItem.create({data:{sessionId:legacySession.id,streamItemKey:randomUUID(),wordId:targetItem.wordId,senseId:targetItem.senseId,itemKind:"LEARNING_CARD",selectionReason:"legacy-recovery",policyVersion:"retrieval-v2",leaseExpiresAt:future,credentialExpiresAt:future,credentialDigest:digestStudyStreamCredential(credential),clientRevision:0}});
    await applyStudyStreamAction(dueUser,{flowVersion:"v2",studySessionId:legacySession.id,streamItemId:oldCard.id,itemCredential:credential,clientKnownRevision:0,operationId:randomUUID(),actionKind:"REVEAL",payload:{}});
    const scoredBefore=await prisma.reviewEvent.count({where:{userId:dueUser}});
    await assert.rejects(()=>action(dueUser,targetView,"OBJECTIVE_ANSWER",{selectedOptionId:targetItem.objectiveQuestionSnapshot!.correctOptionId}),
      (e:unknown)=>e instanceof StudyStreamError&&e.details.code==="STALE_EVIDENCE_TARGET");
    assert.equal(await prisma.reviewEvent.count({where:{userId:dueUser}}),scoredBefore,"曝光競態不計分");
    await getOrCreateStudyStream(dueUser,scope);
    assert.equal((await prisma.studyStreamItem.findUniqueOrThrow({where:{id:targetItem.id}})).status,"SUPERSEDED","原題能自動退役");
    const concurrent=await user();
    const [unitLease,globalLease]=await Promise.all([getOrCreateStudyStream(concurrent,scope),getOrCreateStudyStream(concurrent)]);
    assert.ok(unitLease.item&&globalLease.item);
    assert.notEqual(unitLease.item.streamItemId,globalLease.item.streamItemId);
    const leases=await prisma.studyStreamItem.findMany({where:{session:{userId:concurrent}}});
    assert.equal(new Set(leases.map(l=>l.wordId)).size,2,"跨 scope 不重派同詞");
    await prisma.studySession.update({where:{id:unitLease.session.id},data:{expiresAt:past}});
    assert.equal((await getOrCreateStudyStream(concurrent,scope)).item?.streamItemId,unitLease.item.streamItemId,"過期卡 session 能續接");
    // 其他 session 留下五張租約已過期、未自評的字卡：退役後不能再佔滿初驗名額，全域學習流仍有新詞。
    const abandoned=await user();
    const oldSession=await prisma.studySession.create({data:{userId:abandoned,queueFingerprint:randomUUID(),flowVersion:"v2",learningPolicyVersion:"retrieval-v3",mode:"unit",scopeLevel:"A1",scopeCategory:scope.category,expiresAt:past}});
    const staleCards=[];
    for(const word of words.slice(0,5)) staleCards.push(await prisma.studyStreamItem.create({data:{sessionId:oldSession.id,streamItemKey:randomUUID(),wordId:word.id,senseId:word.senseId,itemKind:"LEARNING_CARD",selectionReason:"abandoned-fixture",policyVersion:"retrieval-v3",leaseExpiresAt:past,credentialExpiresAt:past,credentialDigest:digestStudyStreamCredential(createStudyStreamCredential()),clientRevision:0}}));
    const freed=await getOrCreateStudyStream(abandoned);
    assert.equal(freed.item?.kind,"LEARNING_CARD","過期字卡不能令全域學習流卡死");
    for(const card of staleCards) assert.equal((await prisma.studyStreamItem.findUniqueOrThrow({where:{id:card.id}})).status,"SUPERSEDED","過期未自評字卡退役");
    // 舊未發補救有 Review：移交未來複習，不阻塞新詞；無 Review：有來源的後繼初驗。
    const legacy=await user();
    await prisma.review.create({data:{userId:legacy,wordId:words[0].id,interval:1,nextReviewDate:future}});
    for(let i=0;i<2;i++) await prisma.evidenceObligation.create({data:{userId:legacy,wordId:words[i].id,senseId:words[i].senseId,kind:"REMEDIATION",status:"PENDING",sourceOperationId:`legacy-${randomUUID()}`,policyVersion:"retrieval-v2",selectionReason:"legacy",eligibleAt:future,expiresAt:future}});
    await getOrCreateStudyStream(legacy,scope);
    assert.equal(await prisma.evidenceObligation.count({where:{userId:legacy,status:"SUPERSEDED",terminalReason:"phase-transfer"}}),2);
    assert.equal(await prisma.evidenceObligation.count({where:{userId:legacy,policyVersion:"retrieval-v3",kind:"EVIDENCE_OBLIGATION",wordId:words[1].id}}),1,"無客觀證據的舊補救轉初驗");
    const invalidUser=await user();
    const inactive=await prisma.word.create({data:{term:`inactive-${randomUUID()}`,definition:"失效測試",level:"A1",synonyms:[],antonyms:[]}});fixtureWords.push(inactive.id);
    const invalidWork=await prisma.evidenceObligation.create({data:{userId:invalidUser,wordId:inactive.id,kind:"EVIDENCE_OBLIGATION",policyVersion:"retrieval-v3",selectionReason:"inactive-fixture",eligibleAt:past,expiresAt:future,sourceOperationId:randomUUID()}});
    const orphanTarget=await prisma.objectiveEvidenceTarget.create({data:{userId:invalidUser,wordId:inactive.id,obligationId:invalidWork.id,purpose:"EVIDENCE_OBLIGATION",policyVersion:"retrieval-v3",itemConstructionVersion:"retrieval-v1-mcq-curated-v2",expectedReviewRevision:0,activeKey:randomUUID()}});
    const deletedWordWork=await prisma.evidenceObligation.create({data:{userId:invalidUser,kind:"EVIDENCE_OBLIGATION",policyVersion:"retrieval-v3",selectionReason:"deleted-word-fixture",eligibleAt:past,expiresAt:future,sourceOperationId:randomUUID()}});
    assert.equal((await getOrCreateStudyStream(invalidUser,scope)).item?.kind,"LEARNING_CARD","失效工作不能阻塞合法新詞");
    const retired=await prisma.evidenceObligation.findUniqueOrThrow({where:{id:invalidWork.id}});
    assert.equal(retired.status,"CANCELLED");assert.equal(retired.terminalReason,"content-unavailable");
    assert.equal((await prisma.objectiveEvidenceTarget.findUniqueOrThrow({where:{id:orphanTarget.id}})).status,"CANCELLED","未派失效 target 一併退役");
    assert.equal((await prisma.evidenceObligation.findUniqueOrThrow({where:{id:deletedWordWork.id}})).status,"CANCELLED","已刪詞不留下永久等待");
    console.log("PostgreSQL retrieval-v3 passed: continuous right/wrong, both self-ratings, first score/replay, small scopes, due-only, concurrent scopes, session recovery, legacy transfer");
  } finally {await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.word.deleteMany({where:{id:{in:fixtureWords}}});await prisma.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
