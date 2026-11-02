import test from "node:test";
import assert from "node:assert/strict";
import { selectNextItem } from "./learning-policy/scheduler";
import { RETRIEVAL_V2_POLICY, type CandidateRecord, type SelectionState } from "./learning-policy/types";
const now = Date.parse("2026-11-02T01:00:00Z");
const probe: CandidateRecord = { id:"probe",wordId:"one",kind:"OBJECTIVE_PROBE",purpose:"DUE_REVIEW",policyVersion:"retrieval-v2",selectionReason:"due-review" };
const state: SelectionState = { mode:"unit",now,consecutiveProbes:1,acknowledgedItemsSinceProbe:0,hasPreviousProbe:true,lastProbeAt:now-12000,activeWork:[],candidates:[probe] };
test("a probe-only unit progresses without fabricating answer cards",()=>{
  assert.equal(selectNextItem(state, RETRIEVAL_V2_POLICY).candidate?.id,"probe");
  const blocked = {...state,consecutiveProbes:2};
  assert.equal(selectNextItem(blocked, RETRIEVAL_V2_POLICY).candidate,null);
  assert.equal(selectNextItem({...blocked,now:now+60000}, RETRIEVAL_V2_POLICY).candidate?.id,"probe");
});
test("eligible time is never overridden to fill a small unit",()=>{
  assert.equal(selectNextItem({...state,candidates:[{...probe,eligibleAt:now+600000}]}, RETRIEVAL_V2_POLICY).candidate,null);
});
test("a legal learning card provides a break while probes are burst capped",()=>{
  const card:CandidateRecord={id:"card",wordId:"two",kind:"LEARNING_CARD",policyVersion:"retrieval-v2",selectionReason:"new-word"};
  assert.equal(selectNextItem({...state,consecutiveProbes:2,candidates:[probe,card]},RETRIEVAL_V2_POLICY).candidate?.id,"card");
});
test("nonurgent backlog leaves a new-word opportunity after six acknowledged items",()=>{
  const card:CandidateRecord={id:"fresh",wordId:"two",kind:"LEARNING_CARD",policyVersion:"retrieval-v2",selectionReason:"new-word"};
  const available={...state,hasPreviousProbe:false,candidates:[probe,card],itemsSinceNewWord:6};
  assert.equal(selectNextItem(available,RETRIEVAL_V2_POLICY).candidate?.id,"fresh");
  assert.equal(selectNextItem({...available,candidates:[{...probe,expiresAt:now+1000},card]},RETRIEVAL_V2_POLICY).candidate?.id,"probe");
});
