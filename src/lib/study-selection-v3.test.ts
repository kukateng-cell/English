import test from "node:test";
import assert from "node:assert/strict";
import { selectNextItem } from "./learning-policy/scheduler";
import { initialCheckReady, nextPhaseCursor } from "./learning-policy/phases";
import { RETRIEVAL_V3_POLICY, type CandidateRecord, type SelectionState } from "./learning-policy/types";
import { summarizeObjectivePhases } from "./learning-policy/evidence-phase";
const now = Date.parse("2026-11-02T01:00:00Z");
const initial: CandidateRecord = { id:"initial",wordId:"a",kind:"OBJECTIVE_PROBE",workId:"work",purpose:"EVIDENCE_OBLIGATION",policyVersion:"retrieval-v3",selectionReason:"initial-check" };
const due: CandidateRecord = { id:"due",wordId:"b",kind:"OBJECTIVE_PROBE",purpose:"DUE_REVIEW",policyVersion:"retrieval-v3",selectionReason:"due-review" };
const fresh: CandidateRecord = { id:"new",wordId:"c",kind:"LEARNING_CARD",policyVersion:"retrieval-v3",selectionReason:"new-word" };
const base: SelectionState = { mode:"global",now,consecutiveProbes:20,acknowledgedItemsSinceProbe:0,hasPreviousProbe:true,lastProbeAt:now,activeWork:[],candidates:[initial,due,fresh] };
test("初驗按不同拼寫間隔或返回時間就緒，重複或同拼寫不湊數",()=>{
  assert.equal(initialCheckReady(now,now-12000,["book","CAT"],"apple"),true);
  assert.equal(initialCheckReady(now,now-12000,["book"," BOOK ","ＡＰＰＬＥ"],"apple"),false);
  assert.equal(initialCheckReady(now,now-600000,[],"apple"),true);
});
test("來源輪次持久化 marker，跳過空來源且不受兩題休息阻擋",()=>{
  let state = {...base,phaseCursor:3};
  const seen:string[]=[];
  for(let i=0;i<8;i++) {
    const result=selectNextItem(state,RETRIEVAL_V3_POLICY);
    seen.push(result.candidate!.id);
    state={...state,phaseCursor:nextPhaseCursor(result.overrideReason)};
  }
  assert.deepEqual(seen,["new","initial","due","due","new","initial","due","due"]);
  assert.equal(selectNextItem({...base,candidates:[due]},RETRIEVAL_V3_POLICY).candidate?.id,"due");
});
test("細詞集只在無其他合法來源且無預留阻擋時降低初驗間隔",()=>{
  const pending={...initial,initialGapPending:true};
  assert.equal(selectNextItem({...base,candidates:[pending,fresh],allowSmallPoolInitial:true},RETRIEVAL_V3_POLICY).candidate?.id,"new");
  assert.equal(selectNextItem({...base,candidates:[pending],allowSmallPoolInitial:false},RETRIEVAL_V3_POLICY).candidate,null);
  assert.match(selectNextItem({...base,candidates:[pending],allowSmallPoolInitial:true},RETRIEVAL_V3_POLICY).overrideReason!,/small-pool-initial-check/u);
  assert.equal(selectNextItem({...base,candidates:[{...due,eligibleAt:now+1}],allowSmallPoolInitial:true},RETRIEVAL_V3_POLICY).candidate,null);
});
test("連續可用來源中的五個初驗按 FIFO 不飢餓",()=>{
  const initials=Array.from({length:5},(_,i)=>({...initial,id:`i${i}`,selectionPriority:i}));
  let state={...base,phaseCursor:1,candidates:[...initials,due,fresh]};
  const served:string[]=[];
  for(let i=0;i<20;i++) {
    const d=selectNextItem(state,RETRIEVAL_V3_POLICY);
    if(d.candidate?.workId) { served.push(d.candidate.id);state={...state,candidates:state.candidates.filter(c=>c.id!==d.candidate!.id)}; }
    state={...state,phaseCursor:nextPhaseCursor(d.overrideReason)};
  }
  assert.deepEqual(served,["i0","i1","i2","i3","i4"]);
});
test("初驗與到期正確率分開，舊 evidence 不假造學習階段",()=>{
  const phases=summarizeObjectivePhases([
    {quality:4,probePurpose:"EVIDENCE_OBLIGATION",objectiveEvidenceTarget:{policyVersion:"retrieval-v3"}},
    {quality:2,probePurpose:"EVIDENCE_OBLIGATION",objectiveEvidenceTarget:{policyVersion:"retrieval-v3"}},
    {quality:2,probePurpose:"DUE_REVIEW",objectiveEvidenceTarget:{policyVersion:"retrieval-v3"}},
    {quality:4,probePurpose:"EVIDENCE_OBLIGATION",objectiveEvidenceTarget:{policyVersion:"retrieval-v2"}},
  ]);
  assert.deepEqual(phases.initial,{attempts:2,correct:1,accuracyPercent:50});
  assert.deepEqual(phases.due,{attempts:1,correct:0,accuracyPercent:0});
  assert.deepEqual(phases.unknown,{attempts:1,correct:1,accuracyPercent:100});
});
