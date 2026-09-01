// Generated from the project-root src/ directory by npm run build. Do not edit directly.

// src/extension.ts
import {
  execFileSync
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  CanvasError,
  createCanvas,
  defineFactory,
  isFactoryRunTerminal,
  joinSession
} from "@github/copilot-sdk/extension";

// tandem-client:client.ts
var client_default = `(()=>{var Xe=Object.create;var Ae=Object.defineProperty;var et=Object.getOwnPropertyDescriptor;var tt=Object.getOwnPropertyNames;var nt=Object.getPrototypeOf,at=Object.prototype.hasOwnProperty;var it=(t,n,a,s)=>{if(n&&typeof n=="object"||typeof n=="function")for(let i of tt(n))!at.call(t,i)&&i!==a&&Ae(t,i,{get:()=>n[i],enumerable:!(s=et(n,i))||s.enumerable});return t};var st=(t,n,a)=>(a=t!=null?Xe(nt(t)):{},it(n||!t||!t.__esModule?Ae(a,"default",{value:t,enumerable:!0}):a,t));const e={stage:document.getElementById("stage"),currentStage:document.getElementById("current-stage"),currentStageIndex:document.getElementById("current-stage-index"),phase:document.getElementById("phase"),goal:document.getElementById("goal"),status:document.getElementById("status"),nextActionGuide:document.getElementById("next-action-guide"),questionHost:document.getElementById("question-host"),confirmed:document.getElementById("confirmed"),assumed:document.getElementById("assumed"),deferred:document.getElementById("deferred"),artifactList:document.getElementById("artifact-list"),artifactCount:document.getElementById("artifact-count"),artifactHeading:document.getElementById("artifact-heading"),artifactMeta:document.getElementById("artifact-meta"),artifactContent:document.getElementById("artifact-content"),artifactDiagram:document.getElementById("artifact-diagram"),artifactReview:document.getElementById("artifact-review"),artifactReviewThreads:document.getElementById("artifact-review-threads"),mermaidHost:document.getElementById("mermaid-host"),mermaidSource:document.getElementById("mermaid-source"),diagramStatus:document.getElementById("diagram-status"),diagramSourceDetails:document.getElementById("diagram-source-details"),contentCard:document.getElementById("content-card"),contentEmpty:document.getElementById("content-empty"),designTreePanel:document.getElementById("design-tree-panel"),designTreeCard:document.getElementById("design-tree-card"),designTreeEmpty:document.getElementById("design-tree-empty"),designTreeCurrent:document.getElementById("design-tree-current"),designTreePhase:document.getElementById("design-tree-phase"),designTreeHost:document.getElementById("design-tree-host"),designTreeStatus:document.getElementById("design-tree-status"),designTreeSource:document.getElementById("design-tree-source"),designTreeSourceDetails:document.getElementById("design-tree-source-details"),designReviewTab:document.getElementById("design-review-tab"),reviewCount:document.getElementById("review-count"),designReviewPanel:document.getElementById("design-review-panel"),productDesignSubstage:document.getElementById("product-design-substage"),testDesignSubstage:document.getElementById("test-design-substage"),designReviewTitle:document.getElementById("design-review-title"),designReviewProgress:document.getElementById("design-review-progress"),finishReview:document.getElementById("finish-review"),designReviewThreads:document.getElementById("design-review-threads"),designReviewForm:document.getElementById("design-review-form"),reviewRequestKind:document.getElementById("review-request-kind"),designReviewInput:document.getElementById("design-review-input"),designReviewStatus:document.getElementById("design-review-status"),reviewSubmit:document.getElementById("review-submit"),planTab:document.getElementById("plan-tab"),planPanel:document.getElementById("plan-panel"),planProgress:document.getElementById("plan-progress"),planMaxAgents:document.getElementById("plan-max-agents"),generatePlan:document.getElementById("generate-plan"),finalizePlan:document.getElementById("finalize-plan"),planMetrics:document.getElementById("plan-metrics"),planStrategySection:document.getElementById("plan-strategy-section"),planStrategy:document.getElementById("plan-strategy"),planDagSection:document.getElementById("plan-dag-section"),planDag:document.getElementById("plan-dag"),planDagStatus:document.getElementById("plan-dag-status"),planColumns:document.getElementById("plan-columns"),planWaves:document.getElementById("plan-waves"),planWorkItems:document.getElementById("plan-work-items"),planAgents:document.getElementById("plan-agents"),planRisks:document.getElementById("plan-risks"),planRevisionSection:document.getElementById("plan-revision-section"),planRevisionForm:document.getElementById("plan-revision-form"),planRevisionInput:document.getElementById("plan-revision-input"),optimizePlan:document.getElementById("optimize-plan"),revisePlan:document.getElementById("revise-plan"),planStatus:document.getElementById("plan-status"),implementationTab:document.getElementById("implementation-tab"),implementationPanel:document.getElementById("implementation-panel"),implementationProgress:document.getElementById("implementation-progress"),implementationProgressLabel:document.getElementById("implementation-progress-label"),implementationProgressBar:document.getElementById("implementation-progress-bar"),implementationMetrics:document.getElementById("implementation-metrics"),implementationWaves:document.getElementById("implementation-waves"),implementationWorkItems:document.getElementById("implementation-work-items"),implementationAgents:document.getElementById("implementation-agents"),implementationStrategyForm:document.getElementById("implementation-strategy-form"),implementationStrategyInput:document.getElementById("implementation-strategy-input"),submitImplementationStrategy:document.getElementById("submit-implementation-strategy"),implementationStrategies:document.getElementById("implementation-strategies"),implementationEvents:document.getElementById("implementation-events"),implementationStatus:document.getElementById("implementation-status"),startImplementation:document.getElementById("start-implementation"),stopImplementation:document.getElementById("stop-implementation"),testTab:document.getElementById("test-tab"),testPanel:document.getElementById("test-panel"),testProgress:document.getElementById("test-progress"),testProgressLabel:document.getElementById("test-progress-label"),testProgressBar:document.getElementById("test-progress-bar"),testMetrics:document.getElementById("test-metrics"),testScenarios:document.getElementById("test-scenarios"),testAgents:document.getElementById("test-agents"),testEvents:document.getElementById("test-events"),testStatus:document.getElementById("test-status"),startTests:document.getElementById("start-tests"),previewTabs:Array.from(document.querySelectorAll('[role="tab"]')),previewPanel:document.getElementById("live-preview-panel"),contentPanel:document.getElementById("content-panel"),previewTools:document.getElementById("preview-tools"),previewStatus:document.getElementById("preview-status"),previewTab:document.getElementById("live-preview-tab"),prototypeBuilding:document.getElementById("prototype-building"),prototypeBuildingMessage:document.getElementById("prototype-building-message"),previewEmpty:document.getElementById("preview-empty"),previewFrame:document.getElementById("preview-frame"),openPreview:document.getElementById("open-preview"),workspace:document.getElementById("studio-workspace"),requirements:document.getElementById("requirements-pane"),splitter:document.getElementById("studio-splitter"),reloadButton:document.getElementById("reload-extension"),reloadStatus:document.getElementById("reload-status"),stageList:document.getElementById("stage-list"),completeStage:document.getElementById("complete-stage"),stageMessage:document.getElementById("stage-message"),requirementsSubstageSection:document.getElementById("requirements-substage-section"),usageSubstage:document.getElementById("usage-substage"),dagSubstage:document.getElementById("dag-substage"),usageIntake:document.getElementById("usage-intake"),usageItems:document.getElementById("usage-items"),usageForm:document.getElementById("usage-form"),usageInput:document.getElementById("usage-input"),addUsage:document.getElementById("add-usage"),usageSuggestionArea:document.getElementById("usage-suggestion-area"),usageSuggestions:document.getElementById("usage-suggestions"),generateDag:document.getElementById("generate-dag"),usageMessage:document.getElementById("usage-message"),prototypeReview:document.getElementById("prototype-review"),revisionForm:document.getElementById("revision-form"),revisionInput:document.getElementById("revision-input"),submitRevision:document.getElementById("submit-revision"),revisionQuestion:document.getElementById("revision-question"),revisionQuestionTitle:document.getElementById("revision-question-title"),revisionQuestionRationale:document.getElementById("revision-question-rationale"),revisionQuestionForm:document.getElementById("revision-question-form"),revisionQuestionChoices:document.getElementById("revision-question-choices"),revisionQuestionDetail:document.getElementById("revision-question-detail"),submitClarification:document.getElementById("submit-clarification"),revisionHistory:document.getElementById("revision-history"),revisionStatus:document.getElementById("revision-status")},Re=280,rt=360,Le=.24,Be=24,H=[{id:"requirements",label:"Requirements"},{id:"prototype",label:"Prototype"},{id:"design",label:"Design"},{id:"plan",label:"Plan"},{id:"implement",label:"Implement"},{id:"test",label:"Test"}];let v=null,w=!1,z=!1,$=0,F=!1,X=null,ee="",k="design-tree",M=null,Y=null,K=null,se=0,re=0,oe=0,ke=null,D=!1,Te="",G=!1,qe="",V=null,J=null,de="",le=0;const ve=new WeakMap;let _="";function Fe(){const t=e.workspace.getBoundingClientRect(),n=e.splitter.getBoundingClientRect().width||9;return{workspaceRect:t,min:Re,max:Math.max(Re,t.width-n-rt)}}function he(t){if(window.matchMedia("(max-width: 760px)").matches)return;const n=Fe(),a=Math.round(Math.min(n.max,Math.max(n.min,t)));e.workspace.style.setProperty("--requirements-width",a+"px"),e.splitter.setAttribute("aria-valuemin",String(n.min)),e.splitter.setAttribute("aria-valuemax",String(Math.round(n.max))),e.splitter.setAttribute("aria-valuenow",String(a));const s=n.workspaceRect.width>0?Math.round(a/n.workspaceRect.width*100):Le*100;e.splitter.setAttribute("aria-valuetext",s+"% requirements, "+(100-s)+"% preview")}function He(){if(window.matchMedia("(max-width: 760px)").matches)return;const t=e.requirements.getBoundingClientRect().width;he(t||e.workspace.clientWidth*Le)}function ze(t){const{workspaceRect:n}=Fe();he(t-n.left)}function ye(t,n){X===t&&(X=null,e.splitter.classList.remove("is-dragging"),document.body.classList.remove("is-resizing"),n&&e.splitter.hasPointerCapture(t)&&e.splitter.releasePointerCapture(t))}e.splitter.addEventListener("pointerdown",t=>{t.button!==0||window.matchMedia("(max-width: 760px)").matches||(X=t.pointerId,e.splitter.setPointerCapture(t.pointerId),e.splitter.classList.add("is-dragging"),document.body.classList.add("is-resizing"),ze(t.clientX),t.preventDefault())});e.splitter.addEventListener("pointermove",t=>{X===t.pointerId&&ze(t.clientX)});e.splitter.addEventListener("pointerup",t=>{ye(t.pointerId,!0)});e.splitter.addEventListener("pointercancel",t=>{ye(t.pointerId,!0)});e.splitter.addEventListener("lostpointercapture",t=>{ye(t.pointerId,!1)});e.splitter.addEventListener("keydown",t=>{if(t.key!=="ArrowLeft"&&t.key!=="ArrowRight")return;const n=t.key==="ArrowLeft"?-1:1,a=t.shiftKey?Be*2:Be;he(e.requirements.getBoundingClientRect().width+n*a),t.preventDefault()});window.addEventListener("resize",He);requestAnimationFrame(He);function je(t){const n=t.provider||{},a=t.reloadReceipt,s=n.canReload===!0,i=a?.status==="reloading";e.reloadButton.disabled=!s||i,e.reloadButton.textContent=i?"Reloading...":"Reload latest installed";let r="",m="idle";ee?(r=ee,m="error"):s?a?.status==="reloading"?r=a.message||"Reloading...":a?.status==="success"?(r=a.message||"Reloaded",m="success"):a?.status==="error"?(r=a.message||"Reload failed",m="error"):r="Current session only":r=n.source==="project"?"Available from the user-installed Tandem":"Reload unavailable",e.reloadStatus.textContent=r,e.reloadStatus.dataset.status=m,e.reloadButton.title=s?"Restart this session's provider from the latest installed user extension. This does not download updates.":r}e.reloadButton.addEventListener("click",async()=>{if(!e.reloadButton.disabled){ee="",e.reloadButton.disabled=!0,e.reloadButton.textContent="Checking...",e.reloadStatus.textContent="Checking installed user extension...",e.reloadStatus.dataset.status="idle";try{const t=await fetch("/api/reload",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),n=await t.json();if(!t.ok)throw new Error(n.error||"Reload request failed.");e.reloadButton.textContent="Reloading...",e.reloadStatus.textContent="Reloading this session..."}catch(t){ee=t instanceof Error?t.message:"Reload request failed.",v&&je(v)}}});async function we(t,n){if(!(w||!v||v.processing?.status==="running")){w=!0,e.usageMessage.textContent=t==="generate-dag"?"Generating the DAG from your usage list...":"Adding usage and generating suggestions...",e.usageMessage.dataset.status="idle",pe(v);try{const a=await fetch("/api/answer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({questionId:"usage-intake",answer:n,action:t})}),s=await a.json();if(!a.ok)throw new Error(s.error||"Could not update requirements.")}catch(a){w=!1,e.usageMessage.textContent=a instanceof Error?a.message:"Could not update requirements.",e.usageMessage.dataset.status="error",pe(v,!0)}}}e.usageForm.addEventListener("submit",t=>{t.preventDefault();const n=e.usageInput.value.trim();if(!n){e.usageMessage.textContent="Enter one usage sentence.",e.usageMessage.dataset.status="error";return}e.usageInput.value="",we("add-usage",n)});e.generateDag.addEventListener("click",()=>{we("generate-dag","Generate the requirements DAG from the complete usage list.")});e.revisionForm.addEventListener("submit",async t=>{if(t.preventDefault(),w||!v)return;const n=e.revisionInput.value.trim();if(!n){e.revisionStatus.textContent="Enter a revision suggestion.",e.revisionStatus.dataset.status="error";return}w=!0,e.submitRevision.disabled=!0,e.submitRevision.textContent="Sending...",e.revisionStatus.textContent="";try{const a=await fetch("/api/revision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({suggestion:n})}),s=await a.json();if(!a.ok)throw new Error(s.error||"Could not submit the revision.");e.revisionInput.value=""}catch(a){w=!1,e.revisionStatus.textContent=a instanceof Error?a.message:"Could not submit the revision.",e.revisionStatus.dataset.status="error",v&&Ie(v,!0)}});e.revisionQuestionForm.addEventListener("submit",async t=>{if(t.preventDefault(),w||!v)return;const n=v.prototypeReview?.question;if(!n)return;const a=e.revisionQuestionChoices.querySelector('input[name="revision-clarification"]:checked'),i=e.revisionQuestionDetail.value.trim()||a?.value||"";if(!i){e.revisionStatus.textContent="Choose an option or enter clarification.",e.revisionStatus.dataset.status="error";return}w=!0,e.submitClarification.disabled=!0,e.submitClarification.textContent="Sending...",e.revisionStatus.textContent="";try{const r=await fetch("/api/answer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({questionId:n.id,answer:i,action:"clarify-revision"})}),m=await r.json();if(!r.ok)throw new Error(m.error||"Could not submit clarification.")}catch(r){w=!1,e.revisionStatus.textContent=r instanceof Error?r.message:"Could not submit clarification.",e.revisionStatus.dataset.status="error",v&&Ie(v,!0)}});function be(){const t=e.reviewRequestKind.value;return t==="question"?{type:"question",artifactKind:null,label:"Ask question"}:{type:"artifact",artifactKind:t,label:"Generate artifact"}}e.reviewRequestKind.addEventListener("change",()=>{const t=be();e.reviewSubmit.textContent=t.label,e.designReviewInput.placeholder=t.type==="question"?"Ask about the design, tradeoffs, behavior, or risks.":t.artifactKind==="diagram"?"Describe the architecture, sequence, state, or workflow diagram to generate.":t.artifactKind==="contract"?"Describe the UI-facing boundary or contract to clarify.":t.artifactKind==="test-scenario"?"Describe the integration boundary or user interaction scenario to test.":"Describe the design decision and tradeoff to record."});e.designReviewForm.addEventListener("submit",async t=>{if(t.preventDefault(),w||!v)return;const n=e.designReviewInput.value.trim(),a=(v.artifacts||[]).find(i=>i.id===M);if(!a||a.stage!=="design"){e.designReviewStatus.textContent="Select a Design artifact before starting a review.",e.designReviewStatus.dataset.status="error";return}if(!n){e.designReviewStatus.textContent="Enter a design question or artifact request.",e.designReviewStatus.dataset.status="error";return}const s=be();w=!0,e.reviewSubmit.disabled=!0,e.reviewSubmit.textContent="Queueing...",e.designReviewStatus.textContent="";try{const i=await fetch("/api/design-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:n,type:s.type,artifactKind:s.artifactKind,artifactId:a.id})}),r=await i.json();if(!i.ok)throw new Error(r.error||"Could not queue this review request.");e.designReviewInput.value="",w=!1}catch(i){w=!1,e.designReviewStatus.textContent=i instanceof Error?i.message:"Could not queue this review request.",e.designReviewStatus.dataset.status="error",v&&ne(v,!0)}});e.finishReview.addEventListener("click",async()=>{if(!(e.finishReview.disabled||!v)){w=!0,e.finishReview.disabled=!0,e.finishReview.textContent="Capturing review...",e.designReviewStatus.textContent="";try{const t=await fetch("/api/design-review/finalize",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),n=await t.json();if(!t.ok)throw new Error(n.error||"Could not finish the design review.");w=!1}catch(t){w=!1,e.designReviewStatus.textContent=t instanceof Error?t.message:"Could not finish the design review.",e.designReviewStatus.dataset.status="error",v&&ne(v,!0)}}});async function Ee(t,n){if(w||!v)return;const a=Math.max(1,Math.min(30,Number.parseInt(e.planMaxAgents.value,10)||4));w=!0,e.planStatus.textContent="",te(v);try{const s=await fetch("/api/plan/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:t,instruction:n,maxAgents:a})}),i=await s.json();if(!s.ok)throw new Error(i.error||"Could not generate the execution plan.")}catch(s){w=!1,e.planStatus.textContent=s instanceof Error?s.message:"Could not generate the execution plan.",e.planStatus.dataset.status="error",v&&te(v,!0)}}e.generatePlan.addEventListener("click",()=>{const t=(v?.planning?.workItems||[]).length>0;Ee(t?"revise":"generate",t?"Regenerate the complete plan for the selected agent limit while preserving accepted design scope.":"")});e.optimizePlan.addEventListener("click",()=>{Ee("revise","Reduce unnecessary dependencies and file ownership conflicts, widen safe parallel frontiers, balance agent workload, and shorten scheduled elapsed time without dropping scope or validation.")});e.planRevisionForm.addEventListener("submit",t=>{t.preventDefault();const n=e.planRevisionInput.value.trim();if(!n){e.planStatus.textContent="Describe how the plan should change.",e.planStatus.dataset.status="error";return}e.planRevisionInput.value="",Ee("revise",n)});e.finalizePlan.addEventListener("click",async()=>{if(!(e.finalizePlan.disabled||!v)){w=!0,e.finalizePlan.disabled=!0,e.finalizePlan.textContent="Finalizing...",e.planStatus.textContent="";try{const t=await fetch("/api/plan/finalize",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),n=await t.json();if(!t.ok)throw new Error(n.error||"Could not finalize the execution plan.");w=!1,U(n)}catch(t){w=!1,e.planStatus.textContent=t instanceof Error?t.message:"Could not finalize the execution plan.",e.planStatus.dataset.status="error",v&&te(v,!0)}}});e.startImplementation.addEventListener("click",async()=>{if(!(D||!v)){D=!0,e.implementationStatus.textContent="Starting agents...",e.implementationStatus.dataset.status="idle",O(v,!0);try{const t=await fetch("/api/implementation/start",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),n=await t.json();if(!t.ok)throw new Error(n.error||"Could not start implementation.");e.implementationStatus.textContent="Implementation agents are starting."}catch(t){e.implementationStatus.textContent=t instanceof Error?t.message:"Could not start implementation.",e.implementationStatus.dataset.status="error"}finally{D=!1,v&&O(v,!0)}}});e.stopImplementation.addEventListener("click",async()=>{if(!(D||!v)){D=!0,e.implementationStatus.textContent="Stopping agents...",e.implementationStatus.dataset.status="idle",O(v,!0);try{const t=await fetch("/api/implementation/stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),n=await t.json();if(!t.ok)throw new Error(n.error||"Could not stop implementation.")}catch(t){e.implementationStatus.textContent=t instanceof Error?t.message:"Could not stop implementation.",e.implementationStatus.dataset.status="error"}finally{D=!1,v&&O(v,!0)}}});e.implementationStrategyForm.addEventListener("submit",async t=>{if(t.preventDefault(),D||!v)return;const n=e.implementationStrategyInput.value.trim();if(!n){e.implementationStatus.textContent="Describe how the execution strategy should change.",e.implementationStatus.dataset.status="error";return}D=!0,e.submitImplementationStrategy.disabled=!0,e.submitImplementationStrategy.textContent="Queueing...",e.implementationStatus.textContent="";try{const a=await fetch("/api/implementation/strategy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:n})}),s=await a.json();if(!a.ok)throw new Error(s.error||"Could not queue this adjustment.");e.implementationStrategyInput.value="",U(s)}catch(a){e.implementationStatus.textContent=a instanceof Error?a.message:"Could not queue this adjustment.",e.implementationStatus.dataset.status="error"}finally{D=!1,v&&O(v,!0)}});e.startTests.addEventListener("click",async()=>{if(!(G||!v)){G=!0,e.testStatus.textContent="Starting test agents...",e.testStatus.dataset.status="idle",fe(v,!0);try{const t=await fetch("/api/test/start",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),n=await t.json();if(!t.ok)throw new Error(n.error||"Could not start tests.");e.testStatus.textContent="Test agents are starting."}catch(t){e.testStatus.textContent=t instanceof Error?t.message:"Could not start tests.",e.testStatus.dataset.status="error"}finally{G=!1,v&&fe(v,!0)}}});e.completeStage.addEventListener("click",async()=>{if(e.completeStage.disabled||!v)return;const t=v.lifecycle?.currentStage||"requirements";F=!0,e.completeStage.disabled=!0,e.completeStage.textContent="Saving stage output...",e.stageMessage.textContent="",e.stageMessage.dataset.status="idle";try{const n=await fetch("/api/stage/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stageId:t})}),a=await n.json();if(!n.ok)throw new Error(a.error||"Could not complete this stage.");if(n.status===202&&a.accepted){F=!1,e.stageMessage.textContent="Collecting evidence and generating the draft feature specification...",e.stageMessage.dataset.status="idle",v&&me(v,!0);return}F=!1,U(a)}catch(n){F=!1,e.stageMessage.textContent=n instanceof Error?n.message:"Could not complete this stage.",e.stageMessage.dataset.status="error",v&&me(v,!0)}});function Q(t,n=!1){k=["preview","design-tree","design-review","plan","implementation","test","content"].includes(t)?t:"preview";for(const a of e.previewTabs){const s=a.dataset.tab===k;a.setAttribute("aria-selected",String(s)),a.tabIndex=s?0:-1,s&&n&&a.focus()}e.previewPanel.hidden=k!=="preview",e.designTreePanel.hidden=k!=="design-tree",e.designReviewPanel.hidden=k!=="design-review",e.planPanel.hidden=k!=="plan",e.implementationPanel.hidden=k!=="implementation",e.testPanel.hidden=k!=="test",e.contentPanel.hidden=k!=="content",e.previewTools.hidden=k!=="preview",v&&ae(v)}for(const t of e.previewTabs)t.addEventListener("click",()=>Q(t.dataset.tab)),t.addEventListener("keydown",n=>{const a=e.previewTabs.filter(r=>!r.hidden),s=a.indexOf(t);let i=null;n.key==="ArrowLeft"?i=(s-1+a.length)%a.length:n.key==="ArrowRight"?i=(s+1)%a.length:n.key==="Home"?i=0:n.key==="End"&&(i=a.length-1),i!==null&&(Q(a[i].dataset.tab,!0),n.preventDefault())});function me(t,n=!1){const a=t.lifecycle||{currentStage:"requirements",completedStages:[],outputs:[]},s=new Set(a.completedStages||[]),i=new Map((a.outputs||[]).map(d=>[d.stageId,d])),r=(t.artifacts||[]).some(d=>d.id==="final-code"&&d.kind==="final-code"&&d.stage==="implement"&&d.path&&d.reviewStatus!=="stale"),m=H.every(d=>s.has(d.id)),l=a.currentStage||"requirements",p=Math.max(0,H.findIndex(d=>d.id===l)),x=H[p];if(e.stageList.replaceChildren(),H.forEach((d,g)=>{const c=s.has(d.id),u=d.id===l&&!m,b=c?"complete":u?"active":"locked",E=document.createElement("li"),h=document.createElement("button");h.className="stage-step",h.type="button",h.dataset.status=b,h.disabled=b==="locked",h.setAttribute("aria-current",String(u));const S=document.createElement("span");S.className="stage-step-index",S.textContent=String(g+1);const T=document.createElement("span");T.className="stage-step-label",T.textContent=d.label;const R=document.createElement("span");R.className="stage-step-status",R.textContent=b,h.append(S,T,R);const o=i.get(d.id);o&&h.addEventListener("click",()=>{e.stageMessage.textContent=o.path,e.stageMessage.dataset.status="idle"}),E.append(h),e.stageList.append(E)}),e.currentStageIndex.textContent=String(p+1),e.stage.textContent=x.label,e.currentStage.setAttribute("aria-label","Current lifecycle stage: "+x.label),e.completeStage.disabled=F||m||t.provider?.canSubmitAnswers===!1||t.processing?.status==="running"||l==="prototype"&&(t.previewStatus!=="ready"||!!t.prototypeReview?.question)||l==="requirements"&&(t.requirements?.substage!=="dag"||!Array.isArray(t.decisionGraph?.nodes)||t.decisionGraph.nodes.length===0||t.decisionGraph.nodes.some(d=>!d.answer))||l==="design"&&(!["design-spec","design-review"].includes(t.designReview?.finalizedArtifactId)||!!t.designReview?.processing||!!t.designReview?.finalizeRequested||(t.designReview?.threads||[]).some(d=>d.status!=="resolved")||t.testDesignReview?.finalizedArtifactId!=="test-spec"||!!t.testDesignReview?.processing||!!t.testDesignReview?.finalizeRequested||(t.testDesignReview?.threads||[]).some(d=>d.status!=="resolved"))||l==="plan"&&(t.planning?.status!=="complete"||t.planning?.finalizedArtifactId!=="execution-plan"||!!t.planning?.processing)||l==="implement"&&(t.implementation?.status!=="completed"||t.implementation?.finalizedArtifactId!=="final-code"||!r||(t.implementation?.workItems||[]).some(d=>d.status!=="completed"))||l==="test"&&(t.testing?.status!=="completed"||t.testing?.finalizedArtifactId!=="test-results"||(t.testing?.scenarios||[]).some(d=>d.status!=="passed")),e.completeStage.textContent=m?"All stages complete":F?"Saving stage output...":t.processing?.status==="running"&&t.processing?.action==="generate-design-spec"?"Generating draft feature spec...":"Finish "+x.label.toLowerCase(),!n){const d=[...a.outputs||[]].pop();e.stageMessage.textContent=d?"Saved "+d.path:"Complete the active stage to unlock the next.",e.stageMessage.dataset.status="idle"}}function pe(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="requirements";if(e.requirementsSubstageSection.hidden=!a,!a)return;const s=t.requirements||{substage:We(t).length>0?"dag":"usage",usageItems:[],suggestions:[]},i=s.substage!=="dag";e.usageSubstage.dataset.status=i?"active":"complete",e.dagSubstage.dataset.status=i?"locked":"active",e.usageIntake.hidden=!i;const r=Array.isArray(s.usageItems)?s.usageItems:[];if(e.usageItems.replaceChildren(),r.length===0){const d=document.createElement("li");d.className="muted",d.textContent="No usages added yet.",e.usageItems.append(d)}else r.forEach((d,g)=>{const c=document.createElement("li");c.className="usage-item",c.textContent=g+1+". "+d,e.usageItems.append(c)});const m=Array.isArray(s.suggestions)?s.suggestions:[];e.usageSuggestions.replaceChildren();const l=t.processing?.status==="running"||w,p=t.suggestionProcessing?.status==="running";if(e.usageSuggestionArea.hidden=m.length===0&&!p,p&&m.length===0){const d=document.createElement("li");d.className="muted",d.textContent="Generating AI suggestions...",e.usageSuggestions.append(d)}const x=t.provider?.canSubmitAnswers!==!1;for(const d of m){const g=document.createElement("li"),c=document.createElement("button");c.className="usage-suggestion",c.type="button",c.textContent="+ "+d,c.disabled=l||!x,c.addEventListener("click",()=>{we("add-usage",d)}),g.append(c),e.usageSuggestions.append(g)}e.usageInput.disabled=l||!x,e.addUsage.disabled=l||!x,e.generateDag.disabled=l||!x||r.length===0,e.addUsage.textContent=l?"Working...":"Add usage",e.generateDag.textContent=t.processing?.action==="generate-dag"?"Generating DAG...":"Generate requirements DAG",n||(e.usageMessage.textContent=x?l?t.status||"Updating requirements...":p?r.length===0?"Starter suggestions are loading; you can add a usage now.":"Usage saved. Suggestions are refreshing; you can keep adding usages.":i?r.length===0?"Add the first usage to receive AI suggestions.":"Add another usage or generate the decision DAG.":"Usage collection is complete. Work through the dynamic DAG.":"Open the installed user-scoped Tandem to edit requirements.",e.usageMessage.dataset.status="idle")}function ce(t,n){if(t.replaceChildren(),!Array.isArray(n)||n.length===0){const a=document.createElement("li");a.className="empty-item",a.textContent="None yet",t.append(a);return}for(const a of n){const s=document.createElement("li");s.textContent=a,t.append(s)}}function Se(){return K||(K=import("https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs").then(t=>{const n=t.default;return n.initialize({startOnLoad:!1,securityLevel:"strict",suppressErrorRendering:!0,theme:document.documentElement.dataset.colorMode==="dark"?"dark":"default",flowchart:{htmlLabels:!1,useMaxWidth:!0}}),n}).catch(t=>{throw K=null,t})),K}function ot(t){const n=String(t.getAttribute("viewBox")||"").trim().split(/\\s+/).map(Number);if(n.length===4&&Number.isFinite(n[2])&&n[2]>0)return n[2];const a=Number.parseFloat(t.getAttribute("width")||"");return Number.isFinite(a)&&a>0?a:800}function Oe(t,n){const a=t.previousElementSibling;if(!a?.classList.contains("diagram-toolbar"))return;const s=a.querySelector(".diagram-toolbar-output");s&&(s.textContent=n)}function ue(t){const n=t.querySelector("svg");n&&(ve.set(t,1),n.style.width="100%",n.style.minWidth="0",n.style.maxWidth="none",n.style.height="auto",Oe(t,"Fit"))}function Ne(t,n){const a=t.querySelector("svg");if(!a)return;const s=Math.min(4,Math.max(.25,n));ve.set(t,s),a.style.width=\`\${ot(a)*s}px\`,a.style.minWidth="0",a.style.maxWidth="none",a.style.height="auto",Oe(t,\`\${Math.round(s*100)}%\`)}function Ce(t){if(t.previousElementSibling?.classList.contains("diagram-toolbar")){t.previousElementSibling.hidden=!1,ue(t);return}const n=document.createElement("div");n.className="diagram-toolbar",n.setAttribute("role","toolbar"),n.setAttribute("aria-label","Diagram zoom controls");const a=[{action:"out",label:"\\u2212",title:"Zoom out"},{action:"in",label:"+",title:"Zoom in"},{action:"actual",label:"100%",title:"Actual size"},{action:"fit",label:"Fit",title:"Fit diagram"}];for(const i of a){const r=document.createElement("button");r.type="button",r.textContent=i.label,r.title=i.title,r.setAttribute("aria-label",i.title),r.addEventListener("click",()=>{if(i.action==="fit"){ue(t);return}if(i.action==="actual"){Ne(t,1);return}const m=ve.get(t)||1;Ne(t,m*(i.action==="in"?1.25:.8))}),n.append(r)}const s=document.createElement("span");s.className="diagram-toolbar-output",s.setAttribute("aria-live","polite"),n.append(s),t.before(n),ue(t)}function xe(t){const n=t.previousElementSibling;n?.classList.contains("diagram-toolbar")&&(n.hidden=!0)}async function De(t){const n=String(t?.mermaid||"").trim(),a=++se;if(e.artifactDiagram.hidden=!n,e.mermaidSource.textContent=n,e.mermaidHost.replaceChildren(),xe(e.mermaidHost),e.diagramStatus.textContent="",e.diagramStatus.dataset.status="idle",e.diagramSourceDetails.open=!1,!!n){e.mermaidHost.setAttribute("aria-label",t.title+" workflow diagram"),e.diagramStatus.textContent="Rendering Mermaid diagram...";try{const i=await(await Se()).render("tandem-diagram-"+a,n);if(a!==se)return;e.mermaidHost.innerHTML=i.svg,typeof i.bindFunctions=="function"&&i.bindFunctions(e.mermaidHost),Ce(e.mermaidHost),e.diagramStatus.textContent=""}catch{if(a!==se)return;e.diagramStatus.textContent="Mermaid could not render this diagram. The source is available below.",e.diagramStatus.dataset.status="error",e.diagramSourceDetails.open=!0}}}function We(t){if(t.requirements?.substage==="usage")return[];const n=Array.isArray(t.decisionGraph?.nodes)?t.decisionGraph.nodes:[];return n.length>0?n:t.question?[{id:t.question.id,title:t.question.text,dependencies:[],question:t.question,answer:null,status:"active"}]:[]}function ge(t){return String(t||"").replace(/\\\\/g,"\\\\\\\\").replace(/"/g,"'").replace(/\\r?\\n/g," ")}function dt(t){const n=new Map,a=["flowchart LR"];t.forEach((s,i)=>{const r="Decision"+i;n.set(r,s),a.push("  "+r+'["'+ge(s.title)+'"]')}),t.forEach((s,i)=>{for(const r of s.dependencies||[]){const m=t.findIndex(l=>l.id===r);m>=0&&a.push("  Decision"+m+" --> Decision"+i)}}),a.push("  classDef answered fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328","  classDef active fill:#ddf4ff,stroke:#0969da,stroke-width:3px,color:#1f2328","  classDef toAnswer fill:#fff8c5,stroke:#bf8700,stroke-width:2px,color:#1f2328");for(const s of["answered","active","toAnswer"]){const i=t.map((r,m)=>r.status===s?"Decision"+m:null).filter(Boolean);i.length>0&&a.push("  class "+i.join(",")+" "+s)}return{source:a.join(\`
\`),aliases:n}}function Pe(t,n,a){const s=n.find(m=>m.id===a)||null;if(!s||s.status==="toAnswer")return;Y=s.id;for(const m of e.designTreeHost.querySelectorAll("g.node"))m.dataset.selected=String(m.dataset.decisionId===s.id);const i=["running","error"].includes(t.processing?.status)&&t.processing?.question?.id===s.id?t.processing:null;Ve(s.question,i,t.provider?.canSubmitAnswers!==!1&&(t.lifecycle?.currentStage||"requirements")==="requirements",s);const r=n.filter(m=>m.status==="toAnswer").length;e.designTreeCurrent.textContent=(s.status==="active"?"Active":"Answered")+" \\xB7 "+s.title+(r>0?" \\xB7 "+r+" to answer":"")}async function Ge(t,n,a="answer-decision"){const s=await fetch("/api/answer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({questionId:t,answer:n,action:a})}),i=await s.json();if(!s.ok)throw new Error(i.error||"Could not send answer.");return i}function W(t="",n=!1){z=!1,w=!1,t&&(e.designTreeStatus.textContent=t,e.designTreeStatus.dataset.status=n?"error":"success"),v&&ae(v)}async function Qe(t){if(!z||w||t!==v)return;if((t.lifecycle?.currentStage||"requirements")!=="requirements"||t.requirements?.substage!=="dag"){W();return}if(t.processing?.status==="running")return;if(t.processing?.status==="error"){W(t.processing.message||"Could not apply all recommended answers.",!0);return}const n=(t.decisionGraph?.nodes||[]).find(r=>r.status==="active");if(!n){const r=$;$=0,W(r>0?\`Applied \${r} recommended \${r===1?"answer":"answers"}.\`:"No recommended answers are waiting.");return}const a=String(n.question?.recommended||"").trim();if(!a){W(\`Stopped at "\${n.title}" because it has no recommended answer.\`,!0);return}w=!0,ae(t);const s=e.questionHost.querySelector(".all-recommended"),i=e.questionHost.querySelector(".send");s&&(s.disabled=!0,s.textContent="Applying recommendations..."),i&&(i.disabled=!0);try{await Ge(n.id,a),$+=1}catch(r){W(r instanceof Error?r.message:"Could not apply all recommended answers.",!0)}}async function lt(t){const n=We(t),a=dt(n),s=a.source,i=++re;if(e.designTreeCard.hidden=n.length===0,e.designTreeEmpty.hidden=n.length>0,e.designTreeHost.replaceChildren(),xe(e.designTreeHost),e.designTreeSource.textContent=s,e.designTreeStatus.textContent="",e.designTreeStatus.dataset.status="idle",e.designTreeSourceDetails.open=!1,e.designTreePhase.textContent=t.phase||"discovery",n.length===0){Ve(null,t.processing,!1,null);return}const r=n.find(p=>p.status==="active")||null,m=n.find(p=>p.id===Y&&p.status==="answered"),l=r||m||n.find(p=>p.status==="answered")||null;Y=l?.id||null,e.designTreeStatus.textContent="Rendering requirements DAG...";try{const x=await(await Se()).render("tandem-design-tree-"+i,s);if(i!==re)return;e.designTreeHost.innerHTML=x.svg,typeof x.bindFunctions=="function"&&x.bindFunctions(e.designTreeHost),Ce(e.designTreeHost);for(const[d,g]of a.aliases){const c=Array.from(e.designTreeHost.querySelectorAll("g.node")).find(S=>S.id.includes("-"+d+"-"));if(!c)continue;const u=g.status==="active"&&t.processing?.status!=="running",b=g.status==="answered",E=u||b;if(c.dataset.decisionId=g.id,c.dataset.selectable=String(E),c.dataset.selected=String(g.id===Y),c.setAttribute("aria-label",g.title+". "+(g.status==="active"?"Active question":g.status==="answered"?"Answered":"To answer")),!E)continue;c.setAttribute("role","button"),c.setAttribute("tabindex","0");const h=()=>Pe(t,n,g.id);c.addEventListener("click",h),c.addEventListener("keydown",S=>{S.key!=="Enter"&&S.key!==" "||(S.preventDefault(),h())})}l&&Pe(t,n,l.id),ae(t),e.designTreeStatus.textContent=""}catch{if(i!==re)return;e.designTreeStatus.textContent="Mermaid could not render this requirements DAG. The source is available below.",e.designTreeStatus.dataset.status="error",e.designTreeSourceDetails.open=!0}}function ct(t,n){if(!n)return[];const a=new Set(n.sourceThreadIds||[]);return[...t?.designReview?.threads||[],...t?.testDesignReview?.threads||[]].filter(s=>a.has(s.id)||s.reviewArtifactId===n.id||(s.artifactIds||[]).includes(n.id))}function Ue(t,n,a=!1){const s=document.createElement("div");s.className="review-thread-heading";const i=document.createElement("span");i.className="review-thread-kind",i.textContent=n.type==="artifact"?"Artifact \\xB7 "+String(n.artifactKind||"").replace("-"," "):a?"Test design question":"Product design question";const r=document.createElement("span");r.className="review-thread-state",r.textContent=n.status,s.append(i,r),t.append(s)}function ut(t,n){e.artifactReviewThreads.replaceChildren();const a=n?.stage==="design";if(e.artifactReview.hidden=!a,!a)return;const s=(t.lifecycle?.currentStage||"requirements")==="design";e.designReviewForm.hidden=!s,e.reviewRequestKind.value==="question"&&(e.designReviewInput.placeholder=\`Ask about \${n.title}, its tradeoffs, behavior, or risks.\`);const i=t.design?.substage==="test"?t.testDesignReview:t.designReview,r=new Set((i?.threads||[]).map(l=>l.id)),m=ct(t,n);for(const l of m){const p=document.createElement("article");if(p.className="review-thread",p.dataset.status=l.status,Ue(p,l,(t.testDesignReview?.threads||[]).some(g=>g.id===l.id)),!(l.type==="artifact"&&String(l.id||"").startsWith("default-project-"))){const g=document.createElement("p");if(g.className="review-thread-prompt",g.textContent=l.prompt,p.append(g),l.answer){const c=document.createElement("p");c.className="review-thread-answer",c.textContent=l.answer,p.append(c)}else if(["queued","processing"].includes(l.status)){const c=document.createElement("p");c.className="review-thread-answer muted",c.textContent=l.status==="queued"?"Waiting in the Tandem review queue...":"Tandem is preparing a design response...",p.append(c)}}if(l.error){const g=document.createElement("p");g.className="review-thread-error",g.textContent=l.error,p.append(g)}const d=l.status==="answered"?"resolve":l.status==="resolved"?"reopen":l.status==="failed"?"retry":null;if(d&&r.has(l.id)&&s){const g=document.createElement("div");g.className="review-thread-actions";const c=document.createElement("button");c.type="button",c.className="thread-action",c.dataset.threadAction=d,c.textContent=d==="resolve"?"Mark resolved":d==="reopen"?"Reopen":"Retry",c.disabled=w||t.provider?.canSubmitAnswers===!1,c.addEventListener("click",()=>Je(l.id,d)),g.append(c),p.append(g)}e.artifactReviewThreads.append(p)}}function Me(t){const n=t.find(s=>s.id===M)||null;if(e.contentCard.hidden=!n,e.contentEmpty.hidden=!!n,!n){e.artifactHeading.textContent="Artifact content",e.artifactMeta.textContent="",e.artifactContent.textContent="",e.artifactContent.hidden=!0,e.artifactReview.hidden=!0,e.artifactReviewThreads.replaceChildren(),De(null);return}e.artifactHeading.textContent=n.title;const a=H.find(s=>s.id===n.stage)?.label;e.artifactMeta.textContent=[a,n.kind,n.path,n.reviewStatus==="stale"?"stale":""].filter(Boolean).join(" \\xB7 "),e.artifactContent.textContent=n.content||"",e.artifactContent.hidden=!n.content,De(n),ut(v,n)}function Ke(t){const n=Array.isArray(t)?t:[];n.some(a=>a.id===M)||(M=n[0]?.id||null),e.artifactCount.textContent=n.length>0?"("+n.length+")":"",e.artifactList.replaceChildren();for(const a of H){const s=n.filter(p=>(p.stage||"requirements")===a.id),i=document.createElement("section");i.className="artifact-stage-group",i.setAttribute("aria-label",a.label+" artifacts");const r=document.createElement("h3");r.className="artifact-stage-heading",r.textContent=a.label;const m=document.createElement("span");m.textContent=String(s.length),r.append(m);const l=document.createElement("ul");if(l.className="artifact-stage-items",s.length===0){const p=document.createElement("li");p.className="empty-item",p.textContent="No artifacts yet",l.append(p)}for(const p of s){const x=document.createElement("li"),d=document.createElement("button");d.className="artifact-button",d.type="button",d.dataset.artifactId=p.id,d.setAttribute("aria-current",String(p.id===M));const g=document.createElement("span");g.className="artifact-title",g.textContent=p.title,d.append(g);const c=[p.kind,p.path,p.reviewStatus==="stale"?"stale":""].filter(Boolean).join(" \\xB7 ");if(c){const u=document.createElement("span");u.className="artifact-list-meta",u.textContent=c,d.append(u)}d.addEventListener("click",()=>{M=p.id;for(const u of e.artifactList.querySelectorAll("button"))u.setAttribute("aria-current",String(u.dataset.artifactId===M));Me(n),Q("content")}),x.append(d),l.append(x)}i.append(r,l),e.artifactList.append(i)}Me(n)}const mt={"add-usage":{title:"Updating usage guidance",steps:["Saving the new usage without blocking further input.","Comparing it with the existing usage list.","Generating complementary suggestions."]},"generate-dag":{title:"Building requirements DAG",steps:["Analyzing usages and shared prerequisites.","Creating decision nodes, questions, and dependency edges.","Validating the graph and selecting the first active decision."]},"answer-decision":{title:"Applying your decision",steps:["Recording the answer in the requirements ledger.","Recomputing dependent questions and assumptions.","Promoting the next eligible decision to active."]},"change-answer":{title:"Revising dependent decisions",steps:["Updating the selected answer.","Regenerating every affected downstream decision.","Validating dependencies and selecting the next active decision."]},"submit-revision":{title:"Reviewing prototype revision",steps:["Checking the requested behavior against the current prototype.","Resolving interaction details and applying the revision.","Validating the updated preview and recording evidence."]},"clarify-revision":{title:"Applying your clarification",steps:["Adding the clarification to the active revision.","Updating the affected prototype interactions.","Validating the preview and recording the result."]},"generate-design-spec":{title:"Preparing design specification",steps:["Collecting confirmed requirements and prototype evidence.","Synthesizing workflows, contracts, and interaction states.","Validating the specification for the Design handoff."]}};function Ve(t,n,a,s=null){V!==null&&(window.clearInterval(V),V=null),e.questionHost.replaceChildren();const i=s?.status==="answered"&&n?.status!=="running";if(i){const u=document.createElement("p");u.className="question",u.textContent=t?.text||s.title;const b=document.createElement("p");b.className="muted",b.textContent="Answered";const E=document.createElement("div");E.className="choice";const h=document.createElement("span");if(h.textContent=s.answer||"No answer recorded.",E.append(h),e.questionHost.append(u,b,E),!a)return}if(n?.status==="running"){const u=document.createElement("div");u.className="processing-state",u.setAttribute("role","status"),u.setAttribute("aria-live","polite"),u.setAttribute("aria-atomic","true");const b=document.createElement("span");b.className="processing-indicator",b.setAttribute("aria-hidden","true");const E=document.createElement("span");E.className="processing-copy";const h=document.createElement("span");h.className="processing-heading";const S=document.createElement("strong"),T=document.createElement("span");T.className="processing-dots",T.setAttribute("aria-hidden","true");for(let A=0;A<3;A+=1)T.append(document.createElement("i"));const R=document.createElement("span");R.className="muted";const o=mt[n.action]||{title:"Processing Tandem update",steps:[n.message||"Applying the requested change."]};S.textContent=o.title,h.append(S,T),E.append(h,R),u.append(b,E),e.questionHost.append(u);const f=Date.parse(n.requestedAt||""),y=Number.isFinite(f)?f:Date.now(),C=()=>{const A=Math.max(0,Date.now()-y),B=Math.min(o.steps.length-1,Math.floor(A/4500));R.textContent=o.steps[B]};C(),V=window.setInterval(C,1e3);return}if(n?.status==="error"){const u=document.createElement("p");u.className="processing-error",u.setAttribute("role","alert"),u.textContent=n.message||"Tandem processing failed.",e.questionHost.append(u)}if(!t){const u=document.createElement("p");u.className="muted",u.textContent=n?.status==="success"?"No decision is waiting.":"Preparing the next decision...",e.questionHost.append(u);return}if(!a){const u=document.createElement("p");u.className="provider-notice",u.textContent="Answers are routed through the installed user-scoped Tandem.",e.questionHost.append(u)}const r=document.createElement("p");if(r.className="question",r.textContent=i?"Change this answer":t.text,e.questionHost.append(r),t.rationale&&!i){const u=document.createElement("p");u.className="rationale",u.textContent=t.rationale,e.questionHost.append(u)}const m=document.createElement("form"),l=document.createElement("div");l.className="choices";for(const u of t.choices||[]){const b=document.createElement("label");b.className="choice";const E=document.createElement("input");E.type="radio",E.name="prototype-choice",E.value=u,E.checked=!i&&u===t.recommended;const h=document.createElement("span");if(h.textContent=u,b.append(E,h),u===t.recommended&&!i){const S=document.createElement("span");S.className="recommended",S.textContent="Recommended",b.append(S)}l.append(b)}l.childElementCount>0&&m.append(l);let p=null;t.allowFreeText!==!1&&(p=document.createElement("textarea"),p.name="prototype-detail",p.placeholder=t.answerPlaceholder||(l.childElementCount>0?"Optional context":"Enter your answer"),i&&(p.placeholder="Enter a replacement answer"),p.setAttribute("aria-label","Additional answer context"),p.addEventListener("input",()=>{const u=Array.from(m.querySelectorAll('input[name="prototype-choice"]'));if(p.value.trim()){for(const E of u)E.checked=!1;return}const b=u.find(E=>E.value===t.recommended);b&&(b.checked=!0)}),m.append(p));for(const u of m.querySelectorAll('input[name="prototype-choice"]'))u.addEventListener("change",()=>{u.checked&&p&&(p.value="")});const x=document.createElement("div");x.className="actions";const d=document.createElement("button");d.className="send",d.type="submit",d.textContent=a?i?"Update answer and dependents":"Use this answer":"Open installed Tandem to answer",d.disabled=w||!a;let g=null;!i&&t.recommended&&a&&(g=document.createElement("button"),g.className="all-recommended",g.type="button",g.textContent=z?"Applying recommendations...":"All as Recommended",g.title="Use each active recommendation, updating dependent decisions as the DAG changes.",g.disabled=w||z,g.addEventListener("click",()=>{w||z||!v||(z=!0,$=0,Qe(v))}));const c=document.createElement("p");c.className="error",c.setAttribute("role","alert"),x.append(d),g&&x.append(g),x.append(c),m.append(x),m.addEventListener("submit",async u=>{if(u.preventDefault(),w)return;const b=m.querySelector('input[name="prototype-choice"]:checked'),h=(p?p.value.trim():"")||b?.value||"";if(!h){c.textContent="Choose an option or enter an answer.";return}w=!0,d.disabled=!0,d.textContent="Sending...",c.textContent="";try{await Ge(t.id,h,i?"change-answer":"answer-decision")}catch(S){w=!1,d.disabled=!1,d.textContent=i?"Update answer and dependents":"Use this answer",c.textContent=S instanceof Error?S.message:"Could not send answer."}}),e.questionHost.append(m)}function Ie(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="prototype";if(e.prototypeReview.hidden=!a,!a)return;const s=t.prototypeReview||{revisions:[],activeRevisionId:null,question:null,evidence:[]},i=t.processing?.status==="running",r=t.provider?.canSubmitAnswers!==!1,m=t.previewStatus==="ready",l=s.question||null,p=w||i||!!l||!r||!m;if(e.revisionInput.disabled=p,e.submitRevision.disabled=p,e.submitRevision.textContent=i?"Applying revision...":"Send revision",e.revisionQuestion.hidden=!l,e.revisionQuestionChoices.replaceChildren(),e.revisionQuestionDetail.value="",l){e.revisionQuestionTitle.textContent=l.text,e.revisionQuestionRationale.textContent=l.rationale||"",e.revisionQuestionRationale.hidden=!l.rationale;for(const g of l.choices||[]){const c=document.createElement("label");c.className="revision-question-choice";const u=document.createElement("input");u.type="radio",u.name="revision-clarification",u.value=g,u.checked=g===l.recommended;const b=document.createElement("span");b.textContent=g,c.append(u,b),e.revisionQuestionChoices.append(c)}const d=l.allowFreeText!==!1;e.revisionQuestionDetail.hidden=!d,e.revisionQuestionDetail.disabled=!d||w||i||!r,e.revisionQuestionDetail.placeholder=l.answerPlaceholder||"Optional clarification",e.revisionQuestionDetail.oninput=()=>{if(e.revisionQuestionDetail.value.trim())for(const g of e.revisionQuestionChoices.querySelectorAll('input[name="revision-clarification"]'))g.checked=!1};for(const g of e.revisionQuestionChoices.querySelectorAll('input[name="revision-clarification"]'))g.disabled=w||i||!r,g.addEventListener("change",()=>{g.checked&&(e.revisionQuestionDetail.value="")});e.submitClarification.disabled=w||i||!r,e.submitClarification.textContent=i?"Applying...":"Use this answer"}const x=Array.isArray(s.revisions)?s.revisions:[];e.revisionHistory.replaceChildren();for(const d of x.slice(-5).reverse()){const g=document.createElement("li"),c=document.createElement("strong");c.textContent=d.summary||d.suggestion;const u=document.createElement("span");u.textContent=d.status,g.append(c,u),e.revisionHistory.append(g)}n||(e.revisionStatus.textContent=r?m?i?t.status||"Applying the prototype revision...":l?"Clarify this revision before the prototype is updated.":x.length>0?"Add another revision, or finish Prototype when no changes remain.":"Try the prototype, then describe any revision you want.":"The revision box will enable when the preview is ready.":"Open the installed user-scoped Tandem to submit revisions.",e.revisionStatus.dataset.status=t.processing?.status==="error"?"error":"idle")}async function Je(t,n){if(!w){w=!0;try{const a=await fetch("/api/design-review/thread",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({threadId:t,action:n})}),s=await a.json();if(!a.ok)throw new Error(s.error||"Could not update this review thread.");w=!1,U(s)}catch(a){w=!1,e.designReviewStatus.textContent=a instanceof Error?a.message:"Could not update this review thread.",e.designReviewStatus.dataset.status="error",v&&ne(v,!0)}}}function ne(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="design",s=(t.lifecycle?.completedStages||[]).includes("design"),i=t.design?.substage==="test",r=(i?t.testDesignReview:t.designReview)||{threads:[],processing:null,finalizeRequested:!1,finalizedArtifactId:null},m=Array.isArray(r.threads)?r.threads:[],l=a&&t.provider?.canSubmitAnswers!==!1,p=(t.artifacts||[]).find(h=>h.id===M),x=p?.stage==="design",d=i?r.finalizedArtifactId==="test-spec":["design-spec","design-review"].includes(r.finalizedArtifactId);e.productDesignSubstage.dataset.status=s?"complete":a?i?"complete":"active":"locked",e.testDesignSubstage.dataset.status=s?"complete":a&&i?"active":"locked",e.designReviewTitle.textContent=i?"Integration and interaction test design":"Product design review",e.reviewRequestKind.value==="question"&&(e.designReviewInput.placeholder=x?\`Ask about \${p.title}, its tradeoffs, behavior, or risks.\`:"Select a Design artifact to start a review.");const g=m.filter(h=>h.status!=="resolved"),c=m.filter(h=>["queued","processing"].includes(h.status)).length,u=m.length-g.length;if(e.reviewCount.textContent=m.length>0?"("+m.length+")":"",e.designReviewProgress.textContent=d?"Review captured from "+u+" resolved thread"+(u===1?".":"s."):u+" resolved \\xB7 "+g.length+" open"+(c>0?" \\xB7 "+c+" queued":""),e.designReviewThreads.replaceChildren(),m.length===0){const h=document.createElement("p");h.className="design-review-empty",h.textContent=!a&&!s?"Required project-specific design artifacts will be generated after Prototype.":i?"Ask about integration or interaction coverage, or generate a test scenario.":"Preparing the required project-specific design artifacts for review.",e.designReviewThreads.append(h)}for(const h of m){const S=document.createElement("article");if(S.className="review-thread",S.dataset.status=h.status,S.dataset.threadId=h.id,Ue(S,h,i),h.error){const R=document.createElement("p");R.className="review-thread-error",R.textContent=h.error,S.append(R)}const T=Array.from(new Set([...Array.isArray(h.artifactIds)?h.artifactIds:[],...h.reviewArtifactId?[h.reviewArtifactId]:[]]));if(T.length>0){const R=document.createElement("div");R.className="review-thread-artifacts";for(const o of T){const f=(t.artifacts||[]).find(C=>C.id===o);if(!f)continue;const y=document.createElement("button");y.type="button",y.className="review-artifact-link",y.dataset.threadId=h.id,y.textContent=f.title+(f.reviewStatus==="stale"?" \\xB7 stale":""),y.addEventListener("click",()=>{M=f.id,Ke(t.artifacts),Q("content")}),R.append(y)}S.append(R)}if(h.status==="failed"&&T.length===0&&a){const R=document.createElement("div");R.className="review-thread-actions";const o=document.createElement("button");o.type="button",o.className="thread-action",o.dataset.threadAction="retry",o.textContent="Retry",o.disabled=w||!l,o.addEventListener("click",()=>Je(h.id,"retry")),R.append(o),S.append(R)}e.designReviewThreads.append(S)}const b=be();e.designReviewForm.hidden=!a||!x,e.finishReview.hidden=!a,e.reviewRequestKind.disabled=w||!l;const E=e.reviewRequestKind.querySelector('option[value="test-scenario"]');if(E&&(E.hidden=!i),!i&&e.reviewRequestKind.value==="test-scenario"&&(e.reviewRequestKind.value="question"),e.designReviewInput.disabled=w||!l,e.reviewSubmit.disabled=w||!l,e.reviewSubmit.textContent=w?"Sending...":r.processing?b.type==="question"?"Queue question":"Queue artifact":b.label,e.finishReview.disabled=w||!l||d||!!r.processing||!!r.finalizeRequested||g.length>0,e.finishReview.textContent=d?i?"Test spec captured":"Design spec captured":r.finalizeRequested||r.processing?.action==="finalize"?"Capturing specification...":i?"Finish test design":"Finish product design",!n){const h=m.find(S=>S.status==="failed");e.designReviewStatus.textContent=a?l?h?"A review request failed. Retry it before finishing.":r.processing?"You can queue another request while this one is processing.":d?i?"The test specification is available under Artifacts \\u2192 Design.":"The design specification is available under Artifacts \\u2192 Design.":g.length>0?"Resolve each answer when it is clear.":"Ask another question or finish the review.":"Open the installed user-scoped Tandem to conduct the review.":s?"Design review is complete and remains available for reference.":"Complete Prototype to unlock review actions.",e.designReviewStatus.dataset.status=h?"error":"idle"}}function pt(t){const n=new Map,a=["flowchart LR"];t.forEach((s,i)=>{const r="PlanWork"+i;n.set(s.id,r),a.push("  "+r+'["'+ge(s.title)+"<br/>"+ge(s.agentId)+'"]')});for(const s of t)for(const i of s.dependencies||[])n.has(i)&&a.push("  "+n.get(i)+" --> "+n.get(s.id));return a.join(\`
\`)}function Z(t,n,a){t.replaceChildren();const s=Array.isArray(n)?n:[];if(s.length===0){const i=document.createElement("li");i.className="muted",i.textContent=a,t.append(i);return}for(const i of s){const r=document.createElement("li");r.textContent=i,t.append(r)}}async function gt(t){const n=pt(t),a=++oe;e.planDag.replaceChildren(),xe(e.planDag),e.planDagStatus.textContent="Rendering execution DAG...",e.planDagStatus.dataset.status="idle";try{const i=await(await Se()).render("tandem-plan-"+a,n);if(a!==oe)return;e.planDag.innerHTML=i.svg,typeof i.bindFunctions=="function"&&i.bindFunctions(e.planDag),Ce(e.planDag),e.planDagStatus.textContent=""}catch{if(a!==oe)return;e.planDagStatus.textContent="The execution DAG could not be rendered.",e.planDagStatus.dataset.status="error"}}function te(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="plan";if(e.planTab.hidden=!a,!a)return;const s=t.planning||{status:"idle",summary:"",strategy:"",maxAgents:4,workItems:[],waves:[],agents:[],risks:[],metrics:{},processing:null,finalizedArtifactId:null,error:""},i=Array.isArray(s.workItems)?s.workItems:[],r=Array.isArray(s.waves)?s.waves:[],m=Array.isArray(s.agents)?s.agents:[],l=i.length>0,p=!!s.processing,x=s.finalizedArtifactId==="execution-plan"&&s.status==="complete",d=t.provider?.canSubmitAnswers!==!1;document.activeElement!==e.planMaxAgents&&(e.planMaxAgents.value=String(s.maxAgents||4)),e.planMaxAgents.disabled=p||w||!d,e.generatePlan.disabled=p||w||!d,e.generatePlan.textContent=p?s.processing?.action==="revise"?"Revising...":"Generating...":l?"Regenerate plan":"Generate plan",e.finalizePlan.disabled=p||w||!d||!l||s.status!=="ready",e.finalizePlan.textContent=x?"Plan finalized":"Finalize plan",e.planProgress.textContent=p?"The planning agent is building an optimized execution schedule.":x?"Execution plan captured and ready for implementation.":l?i.length+" work items \\xB7 "+r.length+" parallel waves \\xB7 "+m.length+" agents":"Generate work items, schedule waves, and agent assignments.";const g=[[i.length,"Work items"],[r.length,"Parallel waves"],[m.length,"Agents"],[(s.metrics?.scheduledHours||0)+"h","Elapsed schedule"],[(s.metrics?.parallelismSavingsHours||0)+"h","Parallel time saved"]];e.planMetrics.replaceChildren();for(const[c,u]of g){const b=document.createElement("div");b.className="plan-metric";const E=document.createElement("strong");E.textContent=String(c);const h=document.createElement("span");h.textContent=u,b.append(E,h),e.planMetrics.append(b)}e.planStrategySection.hidden=!l,e.planStrategy.textContent=s.strategy||s.summary||"",e.planDagSection.hidden=!l,e.planColumns.hidden=!l,e.planRevisionSection.hidden=!l,l&&gt(i),e.planWaves.replaceChildren();for(const c of r){const u=document.createElement("div");u.className="plan-wave";const b=document.createElement("div");b.className="plan-wave-heading";const E=document.createElement("strong");E.textContent="Wave "+c.index;const h=document.createElement("span");h.textContent="Hours "+c.startHour+"\\u2013"+c.endHour,b.append(E,h);const S=document.createElement("div");S.className="plan-wave-items";for(const T of c.workItemIds||[]){const R=i.find(f=>f.id===T);if(!R)continue;const o=document.createElement("span");o.className="plan-wave-item",o.textContent=R.agentId+" \\xB7 "+R.title,S.append(o)}u.append(b,S),e.planWaves.append(u)}e.planWorkItems.replaceChildren();for(const c of i){const u=document.createElement("details");u.className="plan-work-item";const b=document.createElement("summary"),E=document.createElement("span");E.className="plan-work-item-heading";const h=document.createElement("strong");h.textContent=c.title;const S=document.createElement("span");S.className="plan-work-item-meta",S.textContent=c.agentId+" \\xB7 "+c.estimatedHours+"h",E.append(h,S),b.append(E);const T=document.createElement("div");T.className="plan-work-item-body";const R=document.createElement("p");R.textContent=c.description;const o=document.createElement("p");o.className="plan-work-item-meta",o.textContent="Role: "+c.agentRole+" \\xB7 Dependencies: "+((c.dependencies||[]).join(", ")||"None")+" \\xB7 Files: "+((c.files||[]).join(", ")||"Owned scope TBD");const f=document.createElement("strong");f.textContent="Acceptance criteria";const y=document.createElement("ul");Z(y,c.acceptanceCriteria,"None recorded");const C=document.createElement("strong");C.textContent="Validation";const A=document.createElement("ul");Z(A,c.validation,"None recorded"),T.append(R,o,f,y,C,A),u.append(b,T),e.planWorkItems.append(u)}e.planAgents.replaceChildren();for(const c of m){const u=document.createElement("div");u.className="plan-agent";const b=document.createElement("strong");b.textContent=c.id;const E=document.createElement("span");E.className="plan-agent-meta",E.textContent=c.estimatedHours+"h \\xB7 "+(c.roles||[]).join(", ")+" \\xB7 "+(c.workItemIds||[]).length+" items",u.append(b,E),e.planAgents.append(u)}Z(e.planRisks,s.risks,"No additional planning risks recorded."),e.planRevisionInput.disabled=p||w||!d,e.optimizePlan.disabled=p||w||!d,e.revisePlan.disabled=p||w||!d,e.revisePlan.textContent=p?"Revising...":"Revise plan",n||(e.planStatus.textContent=d?s.error?s.error:p?"Planning continues asynchronously.":x?"The final execution plan is available under Artifacts \\u2192 Plan.":l?"Review the schedule, revise it, then finalize the plan.":"Set the agent limit and generate the initial plan.":"Open the installed user-scoped Tandem to generate the plan.",e.planStatus.dataset.status=s.status==="failed"||s.error?"error":"idle")}function _e(t,n){if(!t)return"0m";const a=Date.parse(t),s=n?Date.parse(n):Date.now();if(!Number.isFinite(a)||!Number.isFinite(s))return"0m";const i=Math.max(0,Math.round((s-a)/6e4));return i<60?i+"m":Math.floor(i/60)+"h "+i%60+"m"}function j(t,n){const a=document.createElement("p");a.className="muted",a.textContent=n,t.append(a)}function O(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="implement";if(e.implementationTab.hidden=!a,!a)return;const s=t.planning||{workItems:[],waves:[]},i=t.implementation||{status:"idle",currentWaveIndex:0,workItems:[],agents:[],strategySuggestions:[],events:[],error:""},r=t.implementationRuntime||null,m=Array.isArray(s.workItems)?s.workItems:[],l=Array.isArray(i.workItems)?i.workItems:[],p=new Map(l.map(o=>[o.id,o])),x=l.filter(o=>o.status==="completed").length,d=l.filter(o=>o.status==="running").length,g=l.filter(o=>["failed","blocked","cancelled"].includes(o.status)).length,c=["starting","running"].includes(i.status),u=t.provider?.canSubmitAnswers!==!1,b=l.length>0?Math.round(x/l.length*100):0;e.implementationProgress.textContent=c?"Wave "+(i.currentWaveIndex||1)+" is active \\xB7 "+(r?.liveAgentCount||d)+" live agents":i.status==="completed"?"All planned work completed and final code was captured.":g>0?"Review failures, adjust strategy, and retry incomplete work.":"Ready to assign the finalized work items.",e.implementationProgressLabel.textContent=x+" of "+l.length+" complete \\xB7 "+b+"%",e.implementationProgressBar.style.width=b+"%",e.startImplementation.disabled=D||c||!u||i.status==="completed"||m.length===0,e.startImplementation.textContent=i.status==="failed"||i.status==="cancelled"?"Retry incomplete work":i.status==="completed"?"Implementation complete":c?"Agents running...":"Start implementation",e.stopImplementation.hidden=!c,e.stopImplementation.disabled=D||!u,e.implementationStrategyInput.disabled=D||!u||i.status==="completed",e.submitImplementationStrategy.disabled=D||!u||i.status==="completed",e.submitImplementationStrategy.textContent=D?"Queueing...":"Queue adjustment";const E=[[x+"/"+l.length,"Completed"],[r?.liveAgentCount||d,"Live agents"],[i.currentWaveIndex||0,"Current wave"],[g,"Needs attention"],[_e(i.startedAt,i.completedAt),"Elapsed"]];e.implementationMetrics.replaceChildren();for(const[o,f]of E){const y=document.createElement("div");y.className="plan-metric";const C=document.createElement("strong");C.textContent=String(o);const A=document.createElement("span");A.textContent=f,y.append(C,A),e.implementationMetrics.append(y)}e.implementationWaves.replaceChildren();for(const o of s.waves||[]){const f=(o.workItemIds||[]).map(I=>p.get(I)?.status||"pending"),y=f.length>0&&f.every(I=>I==="completed")?"completed":f.some(I=>I==="running")?"running":f.some(I=>["failed","blocked","cancelled"].includes(I))?"failed":"pending",C=document.createElement("div");C.className="implementation-card",C.dataset.status=y;const A=document.createElement("div");A.className="implementation-card-heading";const B=document.createElement("strong");B.textContent="Wave "+o.index;const q=document.createElement("span");q.className="implementation-badge",q.textContent=y,A.append(B,q);const N=document.createElement("p");N.className="implementation-meta",N.textContent=(o.workItemIds||[]).map(I=>m.find(L=>L.id===I)?.title||I).join(" \\xB7 "),C.append(A,N),e.implementationWaves.append(C)}(s.waves||[]).length||j(e.implementationWaves,"No execution waves are available."),e.implementationWorkItems.replaceChildren();for(const o of m){const f=p.get(o.id)||{status:"pending",summary:"",filesChanged:[],validation:[],blockers:[]},y=document.createElement("details");y.className="implementation-card",y.dataset.status=f.status,["running","failed","blocked"].includes(f.status)&&(y.open=!0);const C=document.createElement("summary");C.className="implementation-card-heading";const A=document.createElement("strong");A.textContent=o.title;const B=document.createElement("span");B.className="implementation-badge",B.textContent=f.status,C.append(A,B);const q=document.createElement("div"),N=document.createElement("p");if(N.className="implementation-meta",N.textContent=o.agentId+" \\xB7 "+o.agentRole+" \\xB7 dependencies: "+((o.dependencies||[]).join(", ")||"none"),q.append(N),f.summary){const I=document.createElement("p");I.textContent=f.summary,q.append(I)}if((f.filesChanged||[]).length>0){const I=document.createElement("p");I.className="implementation-meta",I.textContent="Files: "+f.filesChanged.join(", "),q.append(I)}if((f.validation||[]).length>0){const I=document.createElement("p");I.className="implementation-meta",I.textContent="Validation: "+f.validation.join(" \\xB7 "),q.append(I)}if((f.blockers||[]).length>0){const I=document.createElement("p");I.textContent="Blocked: "+f.blockers.join(" \\xB7 "),q.append(I)}y.append(C,q),e.implementationWorkItems.append(y)}const h=new Map((r?.agents||[]).map(o=>[String(o.label||"").replace(/^work:/,""),o])),S=new Map((i.agents||[]).map(o=>[o.workItemId,o])),T=new Set([...S.keys(),...h.keys()]);e.implementationAgents.replaceChildren();for(const o of T){const f=S.get(o)||{},y=h.get(o)||{},C=m.find(ie=>ie.id===o),A=y.status||f.status||"pending",B=document.createElement("div");B.className="implementation-card",B.dataset.status=A;const q=document.createElement("div");q.className="implementation-card-heading";const N=document.createElement("strong");N.textContent=C?.agentId||f.id||"Implementation agent";const I=document.createElement("span");I.className="implementation-badge",I.textContent=A,q.append(N,I);const P=document.createElement("p");P.className="implementation-meta",P.textContent=(C?.agentRole||f.role||"Implementation")+" \\xB7 "+(C?.title||o)+(y.model?" \\xB7 "+y.model:"")+(y.activeMs?" \\xB7 "+Math.round(y.activeMs/1e3)+"s active":"");const L=document.createElement("p");L.textContent=y.activity||f.activity||f.summary||"Waiting for activity.",B.append(q,P,L),e.implementationAgents.append(B)}T.size===0&&j(e.implementationAgents,"Agents appear here after implementation starts."),e.implementationStrategies.replaceChildren();for(const o of[...i.strategySuggestions||[]].reverse()){const f=document.createElement("div");f.className="implementation-strategy";const y=document.createElement("div");y.className="implementation-card-heading";const C=document.createElement("span");C.className="implementation-badge",C.textContent=o.status;const A=document.createElement("span");A.className="implementation-meta",A.textContent=o.waveIndex?"Applied to wave "+o.waveIndex:"Applies at the next wave boundary",y.append(C,A);const B=document.createElement("p");B.textContent=o.text,f.append(y,B),e.implementationStrategies.append(f)}const R=[...(i.events||[]).map(o=>({id:o.id,text:o.message,at:Date.parse(o.at)||0})),...(r?.progress||[]).map(o=>({id:"runtime-"+o.seq,text:o.text,at:Number(o.recordedAt)||0}))].sort((o,f)=>f.at-o.at).slice(0,20);e.implementationEvents.replaceChildren();for(const o of R){const f=document.createElement("div");f.className="implementation-event";const y=document.createElement("div");y.className="implementation-event-heading";const C=document.createElement("p");C.textContent=o.text;const A=document.createElement("time");A.textContent=o.at?new Date(o.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"",y.append(C,A),f.append(y),e.implementationEvents.append(f)}R.length===0&&j(e.implementationEvents,"Run events and factory progress appear here."),n||(e.implementationStatus.textContent=u?r?.error?"Live agent details are unavailable: "+r.error:i.error?i.error:c?"Suggestions are queued immediately and applied before the next wave.":i.status==="completed"?"Final code is available under Artifacts \\u2192 Implement.":g>0?"Retry preserves completed work and reruns only incomplete items.":"Start the agents when the execution plan is ready.":"Open the installed user-scoped Tandem to run implementation.",e.implementationStatus.dataset.status=i.status==="failed"||i.error||r?.error?"error":"idle")}function fe(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="test";if(e.testTab.hidden=!a,!a)return;const s=Array.isArray(t.testDesignReview?.scenarios)?t.testDesignReview.scenarios:[],i=t.testing||{status:"idle",currentWaveIndex:0,scenarios:[],agents:[],events:[],error:""},r=t.testRuntime||null,m=Array.isArray(i.scenarios)?i.scenarios:[],l=new Map(m.map(o=>[o.id,o])),p=m.filter(o=>o.status==="passed").length,x=m.filter(o=>o.status==="running").length,d=m.filter(o=>["failed","blocked"].includes(o.status)).length,g=["starting","running"].includes(i.status),c=i.status==="completed",u=t.provider?.canSubmitAnswers!==!1,b=m.length>0?Math.round(p/m.length*100):0;e.testProgress.textContent=g?"Wave "+(i.currentWaveIndex||1)+" is active \\xB7 "+(r?.liveAgentCount||x)+" live agents":c?"All approved scenarios passed and test evidence was captured.":d>0?"Review failed or blocked scenarios, then retry incomplete tests.":"Ready to execute the approved test specification.",e.testProgressLabel.textContent=p+" of "+m.length+" passed \\xB7 "+b+"%",e.testProgressBar.style.width=b+"%",e.startTests.disabled=G||g||c||!u||s.length===0,e.startTests.textContent=c?"Tests complete":g?"Tests running...":d>0?"Retry incomplete tests":"Run tests";const E=[[p+"/"+m.length,"Passed"],[r?.liveAgentCount||x,"Live agents"],[i.currentWaveIndex||0,"Current wave"],[d,"Needs attention"],[_e(i.startedAt,i.completedAt),"Elapsed"]];e.testMetrics.replaceChildren();for(const[o,f]of E){const y=document.createElement("div");y.className="plan-metric";const C=document.createElement("strong");C.textContent=String(o);const A=document.createElement("span");A.textContent=f,y.append(C,A),e.testMetrics.append(y)}e.testScenarios.replaceChildren();for(const o of s){const f=l.get(o.id)||{status:"pending",summary:"",evidence:[]},y=document.createElement("details");y.className="implementation-card",y.dataset.status=f.status,["running","failed","blocked"].includes(f.status)&&(y.open=!0);const C=document.createElement("summary");C.className="implementation-card-heading";const A=document.createElement("strong");A.textContent=o.title;const B=document.createElement("span");B.className="implementation-badge",B.textContent=f.status,C.append(A,B);const q=document.createElement("div"),N=document.createElement("p");if(N.className="implementation-meta",N.textContent=String(o.type||"integration")+" \\xB7 dependencies: "+((o.dependencies||[]).join(", ")||"none"),q.append(N),o.description){const I=document.createElement("p");I.textContent=o.description,q.append(I)}if(f.summary){const I=document.createElement("p");I.textContent=f.summary,q.append(I)}if((f.evidence||[]).length>0){const I=document.createElement("strong");I.textContent="Evidence";const P=document.createElement("ul");Z(P,f.evidence,"No evidence captured."),q.append(I,P)}y.append(C,q),e.testScenarios.append(y)}s.length===0&&j(e.testScenarios,"Finalize Test design to create executable scenarios.");const h=new Map((r?.agents||[]).map(o=>[String(o.label||"").replace(/^test:/,""),o])),S=new Map((i.agents||[]).map(o=>[o.scenarioId,o])),T=new Set([...S.keys(),...h.keys()]);e.testAgents.replaceChildren();for(const o of T){const f=S.get(o)||{},y=h.get(o)||{},C=s.find(ie=>ie.id===o),A=y.status||f.status||"pending",B=document.createElement("div");B.className="implementation-card",B.dataset.status=A;const q=document.createElement("div");q.className="implementation-card-heading";const N=document.createElement("strong");N.textContent=f.id||"Test agent";const I=document.createElement("span");I.className="implementation-badge",I.textContent=A,q.append(N,I);const P=document.createElement("p");P.className="implementation-meta",P.textContent=(C?.type||"integration")+" \\xB7 "+(C?.title||o)+(y.model?" \\xB7 "+y.model:"")+(y.activeMs?" \\xB7 "+Math.round(y.activeMs/1e3)+"s active":"");const L=document.createElement("p");L.textContent=y.activity||f.activity||f.summary||"Waiting for activity.",B.append(q,P,L),e.testAgents.append(B)}T.size===0&&j(e.testAgents,"Agents appear here after test execution starts.");const R=[...(i.events||[]).map(o=>({id:o.id,text:o.message,at:Date.parse(o.at)||0})),...(r?.progress||[]).map(o=>({id:"runtime-"+o.seq,text:o.text,at:Number(o.recordedAt)||0}))].sort((o,f)=>f.at-o.at).slice(0,20);e.testEvents.replaceChildren();for(const o of R){const f=document.createElement("div");f.className="implementation-event";const y=document.createElement("div");y.className="implementation-event-heading";const C=document.createElement("p");C.textContent=o.text;const A=document.createElement("time");A.textContent=o.at?new Date(o.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"",y.append(C,A),f.append(y),e.testEvents.append(f)}R.length===0&&j(e.testEvents,"Test events and factory progress appear here."),n||(e.testStatus.textContent=u?r?.error?"Live agent details are unavailable: "+r.error:i.error?i.error:g?"Independent scenarios run concurrently within each dependency wave.":c?"Test results are available under Artifacts \\u2192 Test.":d>0?"Retry preserves passing scenarios and reruns only incomplete tests.":"Run the approved integration and interaction scenarios.":"Open the installed user-scoped Tandem to run tests.",e.testStatus.dataset.status=i.status==="failed"||i.error||r?.error?"error":"idle")}function ft(t){const n=t.lifecycle?.currentStage||"requirements",a=t.previewStatus||"waiting",s=n==="prototype"&&!["ready","error"].includes(a);if(e.previewStatus.textContent=s?"building":a,e.previewTab.classList.toggle("prototype-building-tab",s),e.previewTab.setAttribute("aria-label",s?"Live prototype, building":"Live prototype"),e.prototypeBuilding.hidden=!s,J!==null&&(window.clearInterval(J),J=null),s){const r=t.prototypeId||"prototype";r!==de&&(de=r,le=Date.now());const m=["Preparing the prototype workspace and app structure.","Building the primary interaction flow from confirmed requirements.","Connecting screens, states, and representative sample data.","Starting and verifying the runnable preview."],l=()=>{const p=Math.max(0,Date.now()-le),x=Math.min(m.length-1,Math.floor(p/4500));e.prototypeBuildingMessage.textContent=m[x]};l(),J=window.setInterval(l,1e3)}else de="",le=0;const i=t.previewUrl;if(!i||s){e.previewEmpty.style.display=s?"none":"grid",e.previewFrame.style.display="none",e.openPreview.style.display="none";return}e.previewEmpty.style.display="none",e.previewFrame.style.display="block",e.openPreview.style.display="inline",e.openPreview.href=i,e.previewFrame.dataset.url!==i&&(e.previewFrame.dataset.url=i,e.previewFrame.src=i)}function vt(){for(const t of document.querySelectorAll(".next-action-target, .next-action-tab"))t.classList.remove("next-action-target","next-action-tab"),t.removeAttribute("data-next-action-label"),t.removeAttribute("aria-describedby"),t.removeAttribute("title")}function ht(t){if(F||w||D||G||t.provider?.canSubmitAnswers===!1)return null;const n=t.lifecycle?.currentStage||"requirements";if(n==="requirements")return t.processing?.status==="running"?null:t.requirements?.substage!=="dag"?(t.requirements?.usageItems||[]).length>0?{tab:"design-tree",target:e.generateDag,label:"Generate the requirements DAG"}:{tab:"design-tree",target:e.addUsage,label:"Add the first app usage"}:(t.decisionGraph?.nodes||[]).some(a=>a.status==="active")?{tab:"design-tree",target:e.questionHost.querySelector(".send"),label:"Answer the active requirement decision"}:e.completeStage.disabled?null:{target:e.completeStage,label:"Finish requirements collection"};if(n==="prototype")return t.processing?.status==="running"?null:t.prototypeReview?.question?{tab:"preview",target:e.submitClarification,label:"Answer the prototype clarification"}:e.completeStage.disabled?null:{target:e.completeStage,label:"Finish prototype iteration"};if(n==="design"){const a=t.design?.substage==="test"?t.testDesignReview:t.designReview;if(a?.processing||a?.finalizeRequested)return null;const s=document.querySelector('[data-thread-action="retry"]');if(s)return{tab:s.closest("#artifact-review")?"content":"design-review",target:s,label:"Retry the failed design review request"};const i=e.artifactReviewThreads.querySelector('[data-thread-action="resolve"]');if(i)return{tab:"content",target:i,label:"Mark the answered design thread resolved"};const r=(a?.threads||[]).find(m=>["answered","failed"].includes(m.status));if(r){const m=Array.from(e.designReviewThreads.querySelectorAll(".review-artifact-link")).find(l=>l.dataset.threadId===r.id);if(m)return{tab:"design-review",target:m,label:"Open the design artifact for review"}}return e.finishReview.disabled?e.completeStage.disabled?null:{target:e.completeStage,label:"Finish the Design stage"}:{tab:"design-review",target:e.finishReview,label:t.design?.substage==="test"?"Finish integration and interaction test design":"Finish product design"}}if(n==="plan"){if(t.planning?.processing)return null;if(!e.completeStage.disabled)return{target:e.completeStage,label:"Finish execution planning"};const a=(t.planning?.workItems||[]).length>0;return a&&!e.finalizePlan.disabled?{tab:"plan",target:e.finalizePlan,label:"Finalize the execution plan"}:e.generatePlan.disabled?null:{tab:"plan",target:e.generatePlan,label:a?"Regenerate the execution plan":"Generate the execution plan"}}if(n==="implement")return["starting","running"].includes(t.implementation?.status)?null:e.completeStage.disabled?e.startImplementation.disabled?null:{tab:"implementation",target:e.startImplementation,label:["failed","cancelled"].includes(t.implementation?.status)?"Retry incomplete implementation work":"Start implementation"}:{target:e.completeStage,label:"Finish implementation"};if(n==="test"){if(["starting","running"].includes(t.testing?.status))return null;if(!e.completeStage.disabled)return{target:e.completeStage,label:"Finish integration testing"};if(!e.startTests.disabled)return{tab:"test",target:e.startTests,label:(t.testing?.scenarios||[]).some(a=>["failed","blocked"].includes(a.status))?"Retry incomplete integration tests":"Run integration and interaction tests"}}return null}function ae(t){vt();const n=ht(t);if(!n?.target||n.target.disabled){_&&(e.nextActionGuide.textContent="",_="");return}if(n.target.classList.add("next-action-target"),n.target.dataset.nextActionLabel="Next",n.target.title="Next action: "+n.label,n.target.setAttribute("aria-describedby","next-action-guide"),n.label!==_&&(e.nextActionGuide.textContent="Next action: "+n.label,_=n.label),n.tab&&n.tab!==k){const a=e.previewTabs.find(s=>s.dataset.tab===n.tab);a&&!a.hidden&&(a.classList.add("next-action-tab"),a.dataset.nextActionLabel="Next",a.title="Open this tab for the next action: "+n.label,a.setAttribute("aria-describedby","next-action-guide"))}}function U(t){v=t,w=!1;const n=t.lifecycle?.currentStage||"requirements";n!==ke&&(n==="prototype"?k="preview":n==="design"?k="design-review":n==="plan"?k="plan":n==="implement"?k="implementation":n==="test"?k="test":(k==="design-review"||k==="plan"||k==="implementation"||k==="test")&&(k="content"),ke=n),me(t),pe(t),e.phase.textContent=t.phase||"discovery",e.goal.textContent=t.goal||"Waiting for a prototype goal...",e.goal.classList.toggle("muted",!t.goal),e.status.textContent=t.status||"",ce(e.confirmed,t.confirmed),ce(e.assumed,t.assumed),ce(e.deferred,t.deferred),Ke(t.artifacts),lt(t),ft(t),Ie(t),ne(t),te(t),O(t),fe(t),je(t),Q(k),Qe(t)}function $e(t){const n=JSON.stringify(t.implementationRuntime||null),a=JSON.stringify(t.testRuntime||null);v&&v.prototypeId===t.prototypeId&&v.updatedAt===t.updatedAt&&v.provider?.extensionId===t.provider?.extensionId&&v.provider?.canSubmitAnswers===t.provider?.canSubmitAnswers&&n===Te&&a===qe||(Te=n,qe=a,U(t))}function Ye(){const t=(v?.lifecycle?.currentStage||"")==="implement"?"/api/implementation/status":(v?.lifecycle?.currentStage||"")==="test"?"/api/test/status":"/api/state";return fetch(t).then(n=>n.json()).then($e)}Ye().catch(()=>{e.status.textContent="Could not load the studio state."});setInterval(()=>Ye().catch(()=>{}),2e3);const Ze=new EventSource("/events");Ze.onmessage=t=>{try{$e(JSON.parse(t.data))}catch{}};Ze.onerror=()=>{e.status.textContent="Reconnecting to the studio..."};})();
`;

// tandem-styles:styles.css
var styles_default = ':root{color-scheme:light dark;font-family:var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);font-size:var(--text-body-medium, 14px);line-height:var(--leading-body-medium, 20px);background:var(--background-color-default, #fff);color:var(--text-color-default, #1f2328);--studio-accent: var(--text-color-muted, #526f8a);--studio-accent: color-mix( in srgb, var(--true-color-blue, #0969da) 58%, var(--text-color-muted, #656d76) );--studio-accent-strong: var(--text-color-default, #3f5f7d);--studio-accent-strong: color-mix( in srgb, var(--studio-accent) 78%, var(--text-color-default, #1f2328) );--studio-accent-soft: var(--background-color-muted, #eef3f7);--studio-accent-soft: color-mix( in srgb, var(--background-color-default, #fff) 90%, var(--studio-accent) );--studio-panel: var(--background-color-default, #f8fafc);--studio-panel: color-mix( in srgb, var(--background-color-default, #fff) 97%, var(--studio-accent) );--studio-section: var(--background-color-muted, #f4f7fa);--studio-section: color-mix( in srgb, var(--background-color-default, #fff) 94%, var(--studio-accent) );--studio-border: var(--border-color-default, #c8d2dc);--studio-border: color-mix( in srgb, var(--border-color-default, #d0d7de) 78%, var(--studio-accent) );--studio-mark: #3f6582;--studio-mark: color-mix( in srgb, var(--true-color-blue, #0969da) 58%, #475569 );--studio-header: #edf3f8;--studio-header: color-mix( in srgb, var(--background-color-default, #fff) 89%, var(--studio-accent) );--studio-sidebar: #f3f7fa;--studio-sidebar: color-mix( in srgb, var(--background-color-default, #fff) 94%, var(--studio-accent) );--studio-card: var(--background-color-default, #fff);--studio-card: color-mix( in srgb, var(--background-color-default, #fff) 98%, var(--studio-accent) );--next-action-color: #d4a72c}*{box-sizing:border-box}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);white-space:nowrap}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:var(--studio-panel);color:var(--text-color-default, #1f2328)}body.is-resizing{cursor:col-resize;user-select:none}body.is-resizing iframe{pointer-events:none}button,input,textarea{font:inherit;color:inherit}button:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--color-focus-outline, #0969da);outline-offset:2px}.next-action-target{position:relative;z-index:1;box-shadow:0 0 0 2px var(--background-color-default, #fff),0 0 0 4px var(--next-action-color);animation:next-action-target-pulse 1.8s ease-in-out infinite}.next-action-target:after{display:grid;position:absolute;z-index:2;top:-12px;right:-10px;place-items:center;width:21px;height:21px;border:2px solid var(--background-color-default, #fff);border-radius:50%;background:var(--next-action-color);color:var(--color-white, #fff);content:"\\2192";font-size:13px;font-weight:var(--font-weight-bold, 700);line-height:1;pointer-events:none}.app{display:grid;grid-template-rows:auto minmax(0,1fr);height:100%}.topbar{display:flex;align-items:center;gap:14px;min-height:60px;padding:10px 16px;border-bottom:1px solid var(--studio-accent);background:var(--studio-header);box-shadow:inset 3px 0 0 var(--studio-accent),inset 0 -2px color-mix(in srgb,var(--studio-accent) 22%,transparent)}.brand{display:flex;align-items:center;gap:10px;min-width:0}.brand-copy{min-width:0}.mark{display:grid;place-items:center;width:36px;height:36px;flex:0 0 auto;border:1px solid color-mix(in srgb,var(--studio-mark) 80%,#000);border-radius:10px 4px;background:var(--studio-mark);color:var(--color-white, #fff);font-weight:var(--font-weight-semibold, 600);letter-spacing:.06em;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--color-white, #fff) 18%,transparent),0 2px 5px color-mix(in srgb,var(--studio-mark) 24%,transparent)}.brand-subtitle{display:block;margin-top:1px;color:var(--text-color-muted, #656d76);font-size:11px;line-height:14px;letter-spacing:.04em;text-transform:uppercase}h1{margin:0;font-size:var(--text-title-medium, 18px);line-height:var(--leading-title-medium, 24px);font-weight:var(--font-weight-semibold, 600);letter-spacing:-.01em}.topbar-actions{margin-left:auto;display:flex;align-items:center;gap:12px}.lifecycle{display:flex;align-items:center;gap:6px}.stage{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 4px;border:1px solid var(--studio-mark);border-radius:999px;background:var(--studio-mark);color:var(--color-white, #fff);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600);text-transform:capitalize;box-shadow:0 1px 3px color-mix(in srgb,var(--studio-mark) 20%,transparent)}.stage-index{display:grid;place-items:center;width:18px;height:18px;border:1px solid color-mix(in srgb,var(--color-white, #fff) 42%,transparent);border-radius:50%;background:color-mix(in srgb,var(--color-white, #fff) 14%,transparent);color:var(--color-white, #fff);font-size:11px}.reload-control{display:flex;align-items:center;gap:7px;min-width:0}.reload-button{min-height:28px;padding:3px 9px;border:1px solid var(--studio-border);border-radius:4px;background:var(--background-color-default, #fff);color:var(--text-color-default, #1f2328);white-space:nowrap;cursor:pointer}.reload-button:hover:not(:disabled){border-color:var(--studio-accent);background:var(--studio-accent-soft)}.reload-button:disabled{cursor:not-allowed;opacity:.6}.reload-status{max-width:190px;overflow:hidden;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-overflow:ellipsis;white-space:nowrap}.reload-status[data-status=success]{color:var(--studio-accent-strong)}.reload-status[data-status=error]{color:var(--true-color-red, #cf222e)}.phase{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:1px solid var(--studio-border);border-radius:999px;background:var(--background-color-default, #fff);color:var(--studio-accent-strong);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600);text-transform:capitalize}.phase:before{width:6px;height:6px;border-radius:50%;background:var(--studio-accent);content:""}.workspace{--requirements-width: 24%;display:grid;grid-template-columns:minmax(280px,var(--requirements-width)) 9px minmax(360px,1fr);min-height:0}.requirements{min-width:0;overflow:auto;padding:16px;background:var(--studio-sidebar);box-shadow:inset 3px 0 0 var(--studio-accent)}.splitter{position:relative;z-index:2;width:9px;min-width:9px;padding:0;border:0;outline:0;background:transparent;cursor:col-resize;touch-action:none}.splitter:before{position:absolute;inset:0 auto 0 50%;width:1px;content:"";background:var(--studio-border);transform:translate(-50%);transition:width .1s ease,background-color .1s ease}.splitter:hover:before,.splitter:focus-visible:before,.splitter.is-dragging:before{width:3px;background:var(--studio-accent)}.splitter:focus-visible{outline:2px solid var(--color-focus-outline, #0969da);outline-offset:-2px}.preview{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;background:var(--background-color-muted, #f6f8fa)}.previewbar{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border-bottom:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.preview-tabs{display:flex;align-self:stretch;gap:4px}.preview-tab{position:relative;min-height:43px;padding:0 8px;border:0;background:transparent;color:var(--text-color-muted, #656d76);cursor:pointer}.preview-tab:after{position:absolute;right:8px;bottom:-1px;left:8px;height:2px;border-radius:2px 2px 0 0;background:transparent;content:""}.preview-tab:hover{color:var(--text-color-default, #1f2328)}.preview-tab[aria-selected=true]{color:var(--text-color-default, #1f2328);font-weight:var(--font-weight-semibold, 600)}.preview-tab[aria-selected=true]:after{background:var(--color-focus-outline, #0969da)}.preview-tab.next-action-tab:not([aria-selected=true]){color:var(--next-action-color);font-weight:var(--font-weight-semibold, 600)}.preview-tab.next-action-tab:not([aria-selected=true]):before{display:grid;position:absolute;top:3px;right:-2px;place-items:center;width:16px;height:16px;border:2px solid var(--background-color-default, #fff);border-radius:50%;background:var(--next-action-color);color:var(--color-white, #fff);content:"\\2192";font-size:9px;font-weight:var(--font-weight-bold, 700);line-height:1;animation:next-action-beacon 1.8s ease-out infinite}.preview-tab.prototype-building-tab:before{position:absolute;top:7px;right:-1px;width:10px;height:10px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 18%,var(--studio-accent) 42%,var(--studio-accent-strong) 100%);-webkit-mask:radial-gradient(circle,transparent 42%,#000 47%);mask:radial-gradient(circle,transparent 42%,#000 47%);content:"";animation:processing-spin .9s linear infinite}.artifact-count{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-normal, 400)}.preview-tools{display:flex;align-items:center;gap:10px;margin-left:auto}.preview-status{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.open-preview{display:none;color:var(--text-color-default, #1f2328);font-size:var(--text-body-small, 12px)}[hidden]{display:none!important}.frame-wrap{display:grid;grid-template-rows:minmax(300px,1fr) auto;gap:12px;min-height:0;overflow:auto;padding:12px}.preview-surface{position:relative;min-height:300px}.prototype-building{display:grid;height:100%;min-height:260px;padding:24px;place-items:center;border:1px dashed var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.prototype-building-card{display:flex;align-items:flex-start;width:min(460px,100%);gap:12px;padding:16px;border:1px solid var(--studio-border);border-radius:8px;background:var(--studio-accent-soft);box-shadow:0 8px 28px color-mix(in srgb,var(--studio-accent) 10%,transparent)}.prototype-building-card .processing-indicator{width:22px;height:22px}#preview-frame{display:none;width:100%;height:100%;border:1px solid var(--border-color-default, #d0d7de);background:#fff}.prototype-review{padding:12px;border:1px solid var(--studio-border);border-radius:8px;background:var(--background-color-default, #fff)}.prototype-review-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px}.prototype-review-heading strong{font-weight:var(--font-weight-semibold, 600)}.prototype-review-heading span{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.revision-form,.revision-question-form{display:grid;gap:8px}.revision-form textarea,.revision-question-form textarea{min-height:72px;resize:vertical;padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.revision-form button,.revision-question-form button{justify-self:end;padding:7px 12px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.revision-form button:disabled,.revision-question-form button:disabled{cursor:not-allowed;opacity:.55}.revision-question{margin-top:10px;padding:10px;border:1px solid var(--color-focus-outline, #0969da);border-radius:7px;background:var(--true-color-blue-muted, #ddf4ff)}.revision-question-title{margin:0 0 8px;font-weight:var(--font-weight-semibold, 600)}.revision-question-choices{display:grid;gap:6px}.revision-question-choice{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.revision-history{display:grid;gap:5px;margin:10px 0 0;padding:0;list-style:none}.revision-history li{display:flex;justify-content:space-between;gap:10px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.revision-history strong{color:var(--text-color-default, #1f2328);font-weight:var(--font-weight-medium, 500)}.revision-status{min-height:18px;margin:7px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.revision-status[data-status=error]{color:var(--true-color-red, #cf222e)}.preview-empty{display:grid;place-items:center;height:100%;min-height:260px;padding:24px;border:1px dashed var(--border-color-default, #d0d7de);color:var(--text-color-muted, #656d76);text-align:center;background:var(--background-color-default, #fff)}.content-panel{display:grid;grid-template-rows:minmax(0,1fr);min-height:0;padding:12px}.content-card{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;overflow:hidden;border:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.content-heading{padding:10px 12px;border-bottom:1px solid var(--border-color-default, #d0d7de)}.content-heading strong{display:block;font-weight:var(--font-weight-semibold, 600)}.artifact-meta{display:block;overflow:hidden;margin-top:2px;color:var(--text-color-muted, #656d76);font-family:var(--font-mono, "SFMono-Regular", Consolas, monospace);font-size:var(--text-code-inline, 12px);text-overflow:ellipsis;white-space:nowrap}.artifact-body{min-height:0;overflow:auto}.artifact-diagram{padding:14px;border-bottom:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-muted, #f6f8fa)}.diagram-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-bottom:7px}.diagram-toolbar button{min-width:30px;padding:4px 8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:5px;background:var(--background-color-default, #fff);color:var(--text-color-default, #1f2328);cursor:pointer;font-size:var(--text-body-small, 12px)}.diagram-toolbar button:hover{border-color:var(--studio-accent);background:var(--studio-accent-soft)}.diagram-toolbar-output{min-width:42px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-align:center}.mermaid-host{min-height:180px;overflow:auto;padding:12px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.mermaid-host svg{display:block;width:100%;min-width:520px;height:auto;margin:0 auto}.diagram-status{min-height:18px;margin:7px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.diagram-status[data-status=error]{color:var(--true-color-red, #cf222e)}.diagram-source{margin-top:8px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.diagram-source summary{width:fit-content;cursor:pointer}.diagram-source pre{overflow:auto;margin:7px 0 0;padding:10px;border:1px solid var(--border-color-default, #d0d7de);border-radius:4px;background:var(--background-color-default, #fff);color:var(--text-color-default, #1f2328);font-family:var(--font-mono, "SFMono-Regular", Consolas, monospace);font-size:var(--text-code-block, 12px);white-space:pre}.artifact-content{margin:0;padding:14px;color:var(--text-color-default, #1f2328);font-family:var(--font-mono, "SFMono-Regular", Consolas, monospace);font-size:var(--text-code-block, 12px);line-height:1.55;tab-size:2;white-space:pre-wrap;overflow-wrap:anywhere}.artifact-review{margin:0 14px 14px;border:1px solid var(--border-color-default, #d0d7de);border-radius:8px;background:var(--background-color-default, #fff)}.artifact-review-heading{display:grid;gap:2px;padding:11px 14px;border-bottom:1px solid var(--border-color-default, #d0d7de)}.artifact-review-heading span{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.artifact-review-threads{display:grid;gap:9px;padding:12px 14px}.artifact-review-threads:empty{display:none}.content-empty{display:grid;place-items:center;min-height:0;padding:24px;color:var(--text-color-muted, #656d76);text-align:center}.design-tree-panel{min-height:0;overflow:auto;padding:12px}.requirements-intake-panel{margin-bottom:12px}.requirements-intake-panel .requirements-substages{max-width:520px}@media(min-width:760px){.requirements-intake-panel .usage-form{grid-template-columns:minmax(0,1fr) auto}}.design-review-panel{min-height:0;padding:12px}.design-review-card{display:grid;grid-template-rows:auto minmax(0,1fr);height:100%;min-height:0;overflow:hidden;border:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.design-review-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;border-bottom:1px solid var(--border-color-default, #d0d7de)}.design-review-title{display:grid;gap:2px}.design-substages{display:flex;gap:6px;margin:0;padding:0;list-style:none}.design-substage{padding:3px 8px;border:1px solid var(--studio-border);border-radius:999px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.design-substage[data-status=active]{border-color:var(--studio-accent-strong);background:var(--studio-accent-soft);color:var(--studio-accent-strong);font-weight:var(--font-weight-semibold, 600)}.design-substage[data-status=complete]:before{content:"\\2713  ";color:var(--true-color-green, #1a7f37)}.design-review-title span,.design-review-status{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.finish-review,.review-submit,.thread-action{padding:7px 11px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.finish-review:disabled,.review-submit:disabled,.thread-action:disabled{cursor:not-allowed;opacity:.55}.design-review-threads{min-height:0;overflow:auto;padding:14px;background:var(--background-color-muted, #f6f8fa)}.design-review-empty{display:grid;place-items:center;min-height:180px;margin:0;color:var(--text-color-muted, #656d76);text-align:center}.review-thread{padding:12px;border:1px solid var(--border-color-default, #d0d7de);border-radius:8px;background:var(--background-color-default, #fff)}.review-thread+.review-thread{margin-top:10px}.review-thread[data-status=resolved]{border-color:var(--true-color-green, #1a7f37)}.review-thread[data-status=failed]{border-color:var(--true-color-red, #cf222e)}.review-thread-heading,.review-thread-actions,.review-composer-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.review-thread-kind,.review-thread-state{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.review-thread-state{padding:2px 7px;border:1px solid var(--border-color-default, #d0d7de);border-radius:999px}.review-thread-prompt{margin:9px 0 0;font-weight:var(--font-weight-semibold, 600);white-space:pre-wrap}.review-thread-answer{margin:9px 0 0;color:var(--text-color-default, #1f2328);white-space:pre-wrap}.review-thread-error{margin:9px 0 0;color:var(--true-color-red, #cf222e);font-size:var(--text-body-small, 12px)}.review-thread-artifacts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.review-artifact-link{padding:4px 8px;border:1px solid var(--studio-border);border-radius:999px;background:var(--studio-accent-soft);cursor:pointer;font-size:var(--text-body-small, 12px)}.review-thread-actions{justify-content:flex-end;margin-top:10px}.thread-action{padding:5px 9px;background:var(--background-color-default, #fff);color:var(--studio-accent-strong)}.design-review-composer{display:grid;gap:9px;padding:12px 14px;border-top:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.review-request-kind{padding:7px 9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.design-review-composer textarea{min-height:74px;resize:vertical;padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.design-review-status[data-status=error]{color:var(--true-color-red, #cf222e)}.plan-panel{min-height:0;overflow:auto;padding:12px}.plan-workspace{display:grid;gap:12px}.plan-heading,.plan-controls,.plan-actions,.plan-wave-heading,.plan-work-item-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.plan-heading{padding:12px 14px;border:1px solid var(--studio-border);border-radius:8px;background:var(--background-color-default, #fff)}.plan-heading-copy{display:grid;gap:2px}.plan-heading-copy span,.plan-status,.plan-work-item-meta,.plan-agent-meta{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.plan-controls{justify-content:flex-end;flex-wrap:wrap}.plan-agent-limit{display:inline-flex;align-items:center;gap:6px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.plan-agent-limit input{width:58px;padding:6px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.plan-button{padding:7px 11px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.plan-button.secondary{background:var(--background-color-default, #fff);color:var(--studio-accent-strong)}.plan-button:disabled{cursor:not-allowed;opacity:.55}.plan-metrics{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:8px}.plan-metric{padding:10px;border:1px solid var(--studio-border);border-radius:7px;background:var(--background-color-default, #fff)}.plan-metric strong,.plan-metric span{display:block}.plan-metric strong{font-size:var(--text-title-medium, 18px)}.plan-metric span{margin-top:2px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.plan-section{padding:12px;border:1px solid var(--studio-border);border-radius:8px;background:var(--background-color-default, #fff)}.plan-section>h3{margin:0 0 9px;font-size:var(--text-body-medium, 14px)}.plan-strategy{margin:0;white-space:pre-wrap}.plan-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,30%);gap:12px;align-items:start}.plan-main,.plan-sidebar,.plan-waves,.plan-work-items,.plan-agents{display:grid;gap:9px}.plan-wave{padding:10px;border-left:3px solid var(--studio-accent);border-radius:0 7px 7px 0;background:var(--studio-accent-soft)}.plan-wave-heading strong{font-weight:var(--font-weight-semibold, 600)}.plan-wave-heading span{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.plan-wave-items{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.plan-wave-item{padding:4px 7px;border:1px solid var(--studio-border);border-radius:999px;background:var(--background-color-default, #fff);font-size:var(--text-body-small, 12px)}.plan-work-item{border:1px solid var(--border-color-default, #d0d7de);border-radius:7px;background:var(--background-color-default, #fff)}.plan-work-item summary{padding:9px 10px;cursor:pointer}.plan-work-item-body{padding:0 10px 10px;border-top:1px solid var(--border-color-default, #d0d7de)}.plan-work-item-body p{margin:9px 0}.plan-work-item-body ul,.plan-risks{margin:6px 0 0;padding-left:20px}.plan-agent{padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:7px}.plan-agent strong{display:block}.plan-revision-form{display:grid;gap:8px}.plan-revision-form textarea{min-height:74px;resize:vertical;padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.plan-status[data-status=error]{color:var(--true-color-red, #cf222e)}.implementation-panel{min-height:0;overflow:auto;padding:12px}.implementation-workspace,.implementation-list,.implementation-agents,.implementation-events,.implementation-strategies{display:grid;gap:9px}.implementation-heading,.implementation-heading-copy,.implementation-controls,.implementation-progress-copy,.implementation-card-heading,.implementation-event-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.implementation-heading{padding:12px 14px;border:1px solid var(--studio-border);border-radius:8px;background:var(--background-color-default, #fff)}.implementation-heading-copy{display:grid;justify-content:start;gap:2px}.implementation-heading-copy span,.implementation-meta,.implementation-status{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.implementation-controls{justify-content:flex-end;flex-wrap:wrap}.implementation-progress-track{height:8px;overflow:hidden;margin-top:9px;border-radius:999px;background:var(--background-color-muted, #eaeef2)}.implementation-progress-bar{width:0;height:100%;border-radius:inherit;background:var(--studio-accent-strong);transition:width .2s ease}.implementation-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);gap:12px;align-items:start}.implementation-main,.implementation-sidebar{display:grid;gap:12px}.implementation-card,.implementation-event,.implementation-strategy{padding:10px;border:1px solid var(--border-color-default, #d0d7de);border-radius:7px;background:var(--background-color-default, #fff)}.implementation-card[data-status=running]{border-color:var(--studio-accent-strong);box-shadow:inset 3px 0 0 var(--studio-accent-strong)}.implementation-card[data-status=completed]{box-shadow:inset 3px 0 0 var(--true-color-green, #1a7f37)}.implementation-card[data-status=failed],.implementation-card[data-status=blocked],.implementation-card[data-status=cancelled]{box-shadow:inset 3px 0 0 var(--true-color-red, #cf222e)}.implementation-badge{flex:0 0 auto;padding:2px 7px;border:1px solid var(--studio-border);border-radius:999px;color:var(--text-color-muted, #656d76);font-size:11px;text-transform:capitalize}.implementation-card p,.implementation-event p,.implementation-strategy p{margin:6px 0 0}.implementation-strategy-form{display:grid;gap:8px}.implementation-strategy-form textarea{min-height:74px;resize:vertical;padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.implementation-event time{color:var(--text-color-muted, #656d76);font-size:11px}.implementation-status[data-status=error]{color:var(--true-color-red, #cf222e)}@media(max-width:980px){.plan-metrics{grid-template-columns:repeat(2,minmax(120px,1fr))}.plan-columns,.implementation-grid{grid-template-columns:1fr}}.design-tree-card{display:grid;grid-template-columns:minmax(340px,1fr) minmax(280px,34%);grid-template-rows:auto minmax(0,1fr);height:100%;min-height:0;overflow:hidden;border:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.design-tree-heading{display:flex;grid-column:1 / -1;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 14px;border-bottom:1px solid var(--border-color-default, #d0d7de)}.design-tree-location{display:grid;gap:3px;min-width:0}.design-tree-location span{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600);letter-spacing:.04em;text-transform:uppercase}.design-tree-location strong{overflow-wrap:anywhere}.design-tree-phase{flex:0 0 auto;padding:3px 8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:999px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.design-tree-body{grid-column:1;min-height:0;overflow:auto;padding:14px;background:var(--background-color-muted, #f6f8fa)}.design-tree-inspector{grid-column:2;min-height:0;overflow:auto;padding:14px;border-left:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.design-tree-inspector .eyebrow{margin-bottom:8px}.design-tree-host g.node[data-selectable=true]{cursor:pointer}.design-tree-host g.node[data-selectable=true]:focus{outline:none}.design-tree-host g.node[data-selected=true]>rect,.design-tree-host g.node[data-selected=true]>polygon,.design-tree-host g.node[data-selected=true]>path{filter:drop-shadow(0 0 3px var(--color-focus-outline, #0969da));stroke-width:4px!important}.design-tree-host{min-height:320px}.design-tree-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0 0 10px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.design-tree-legend span{display:inline-flex;align-items:center;gap:6px}.design-tree-legend i{width:10px;height:10px;border:2px solid var(--border-color-default, #d0d7de);border-radius:3px;background:var(--background-color-default, #fff)}.design-tree-legend .answered{border-color:var(--true-color-green, #1a7f37);background:var(--true-color-green-muted, #dafbe1)}.design-tree-legend .active{border-color:var(--color-focus-outline, #0969da);background:var(--true-color-blue-muted, #ddf4ff)}.design-tree-legend .to-answer{border-color:var(--true-color-yellow, #bf8700);background:var(--true-color-yellow-muted, #fff8c5)}.section{margin-bottom:14px;padding:14px;border:1px solid var(--studio-border);border-radius:10px;background:var(--studio-card);box-shadow:0 1px 3px color-mix(in srgb,var(--studio-accent) 9%,transparent)}.section:last-child{margin-bottom:0}.stage-list{display:grid;gap:7px;margin:0;padding:0;list-style:none}.stage-step{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;padding:8px 9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff);text-align:left}.stage-step[data-status=active]{border-color:var(--color-focus-outline, #0969da);background:var(--true-color-blue-muted, #ddf4ff)}.stage-step[data-status=complete]{border-color:var(--true-color-green, #1a7f37)}.stage-step:disabled{color:var(--text-color-muted, #656d76);cursor:not-allowed;opacity:.62}.stage-step-index{display:grid;place-items:center;width:22px;height:22px;border:1px solid currentColor;border-radius:50%;font-size:var(--text-body-small, 12px)}.stage-step-label{min-width:0;font-weight:var(--font-weight-semibold, 600)}.stage-step-status{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.complete-stage{width:100%;margin-top:10px;padding:8px 10px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.complete-stage:disabled{cursor:not-allowed;opacity:.55}.stage-message{min-height:18px;margin:7px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);overflow-wrap:anywhere}.stage-message[data-status=error]{color:var(--true-color-red, #cf222e)}.requirements-substages{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0 0 12px;padding:0;list-style:none}.requirements-substage{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;gap:7px;padding:7px 8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.requirements-substage[data-status=active]{border-color:var(--color-focus-outline, #0969da);background:var(--true-color-blue-muted, #ddf4ff);color:var(--text-color-default, #1f2328)}.requirements-substage[data-status=complete]{border-color:var(--true-color-green, #1a7f37);color:var(--text-color-default, #1f2328)}.requirements-substage-index{display:grid;place-items:center;width:20px;height:20px;border:1px solid currentColor;border-radius:50%;font-size:11px}.usage-intro{margin:0 0 10px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.usage-items,.usage-suggestions{display:grid;gap:6px;margin:0 0 10px;padding:0;list-style:none}.usage-item{padding:7px 9px;border-left:3px solid var(--true-color-green, #1a7f37);border-radius:0 5px 5px 0;background:var(--true-color-green-muted, #dafbe1);overflow-wrap:anywhere}.usage-form{display:grid;gap:7px;margin-bottom:12px}.usage-form input{width:100%;padding:8px 9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.usage-form button,.usage-suggestion,.generate-dag{padding:7px 9px;border:1px solid var(--studio-accent-strong);border-radius:6px;cursor:pointer}.usage-form button,.generate-dag{background:var(--studio-accent-strong);color:var(--color-white, #fff);font-weight:var(--font-weight-semibold, 600)}.usage-suggestion{width:100%;background:var(--studio-accent-soft);color:var(--text-color-default, #1f2328);text-align:left}.usage-form button:disabled,.usage-suggestion:disabled,.generate-dag:disabled{cursor:not-allowed;opacity:.55}.usage-suggestion-heading{margin:0 0 7px;color:var(--studio-accent-strong);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600)}.generate-dag{width:100%}.usage-message{min-height:18px;margin:7px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.usage-message[data-status=error]{color:var(--true-color-red, #cf222e)}.eyebrow{display:flex;align-items:center;gap:7px;margin:0 0 6px;color:var(--studio-accent-strong);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600);letter-spacing:.04em;text-transform:uppercase}.eyebrow:before{width:7px;height:7px;border-radius:2px;background:var(--studio-accent);content:"";transform:rotate(45deg)}.goal{margin:0;white-space:pre-wrap}.muted{color:var(--text-color-muted, #656d76)}.status{margin:9px 0 0;padding:7px 9px;border-left:3px solid var(--studio-accent);border-radius:0 5px 5px 0;background:var(--studio-accent-soft);color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.status:empty{display:none}.question-card{padding:12px;border:1px solid var(--studio-border);border-radius:7px;background:var(--background-color-default, #fff)}.processing-state,.processing-error,.provider-notice{display:flex;align-items:flex-start;gap:9px;margin:0;padding:10px;border-radius:7px;font-size:var(--text-body-small, 12px)}.processing-state{position:relative;min-height:48px;overflow:hidden;border:1px solid var(--studio-border);background:var(--studio-accent-soft)}.processing-state:after{position:absolute;inset:0;background:linear-gradient(110deg,transparent 20%,color-mix(in srgb,var(--studio-accent) 12%,transparent) 48%,transparent 76%);content:"";pointer-events:none;transform:translate(-100%);animation:processing-shimmer 2.4s ease-in-out infinite}.processing-error{margin-bottom:10px;border:1px solid color-mix(in srgb,var(--true-color-red, #cf222e) 45%,var(--studio-border));background:color-mix(in srgb,var(--background-color-default, #fff) 93%,var(--true-color-red, #cf222e));color:var(--true-color-red, #cf222e)}.provider-notice{margin-bottom:10px;border:1px solid var(--studio-border);background:var(--studio-accent-soft);color:var(--text-color-muted, #656d76)}.processing-indicator{width:18px;height:18px;margin-top:1px;flex:0 0 auto;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 18%,var(--studio-accent) 42%,var(--studio-accent-strong) 100%);-webkit-mask:radial-gradient(circle,transparent 45%,#000 48%);mask:radial-gradient(circle,transparent 45%,#000 48%);animation:processing-spin .9s linear infinite}.processing-copy{display:grid;gap:4px;min-width:0}.processing-copy strong{color:var(--text-color-default, #1f2328)}.processing-heading{display:flex;align-items:baseline;gap:6px}.processing-dots{display:inline-flex;align-items:center;gap:3px}.processing-dots i{width:4px;height:4px;border-radius:50%;background:var(--studio-accent-strong);animation:processing-dot 1.1s ease-in-out infinite}.processing-dots i:nth-child(2){animation-delay:.14s}.processing-dots i:nth-child(3){animation-delay:.28s}@keyframes processing-spin{to{transform:rotate(360deg)}}@keyframes processing-dot{0%,60%,to{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}@keyframes processing-shimmer{0%,25%{transform:translate(-100%)}75%,to{transform:translate(100%)}}@keyframes next-action-beacon{0%{box-shadow:0 0 color-mix(in srgb,var(--next-action-color) 45%,transparent)}70%,to{box-shadow:0 0 0 7px transparent}}@keyframes next-action-target-pulse{0%,to{box-shadow:0 0 0 2px var(--background-color-default, #fff),0 0 0 4px color-mix(in srgb,var(--next-action-color) 80%,transparent)}50%{box-shadow:0 0 0 2px var(--background-color-default, #fff),0 0 0 6px color-mix(in srgb,var(--next-action-color) 35%,transparent)}}@media(prefers-reduced-motion:reduce){.processing-dots i,.processing-state:after,.preview-tab.next-action-tab:before,.next-action-target{animation:none}}.question{margin:0;font-size:var(--text-body-large, 15px);line-height:22px;font-weight:var(--font-weight-semibold, 600)}.rationale{margin:6px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.choices{display:grid;gap:7px;margin:12px 0}.choice{display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--studio-border);border-radius:7px;background:var(--background-color-default, #fff);cursor:pointer}.choice:hover,.choice:focus-within{border-color:var(--studio-accent);background:var(--studio-accent-soft)}.choice:has(input:checked){border-color:var(--studio-accent);background:var(--studio-accent-soft)}.choice input{margin-top:3px}.recommended{margin-left:auto;color:var(--text-color-muted, #656d76);font-size:11px}textarea{width:100%;min-height:70px;resize:vertical;padding:8px;border:1px solid var(--studio-border);border-radius:4px;background:var(--background-color-default, #fff)}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:9px}.send,.all-recommended{padding:6px 12px;border:1px solid var(--studio-accent-strong);border-radius:7px;cursor:pointer}.send{background:var(--studio-accent-strong);color:var(--background-color-default, #fff)}.all-recommended{background:var(--background-color-default, #fff);color:var(--studio-accent-strong)}.send:disabled,.all-recommended:disabled{cursor:not-allowed;opacity:.5}.error{min-height:20px;margin:0;color:var(--true-color-red, #cf222e);font-size:var(--text-body-small, 12px)}.ledger{display:grid;gap:11px}.ledger-details{display:block}.ledger-summary{margin:0;cursor:pointer}.ledger-details[open] .ledger-summary{margin-bottom:11px}.ledger h3{display:flex;align-items:center;gap:6px;margin:0 0 4px;font-size:var(--text-body-medium, 14px);font-weight:var(--font-weight-semibold, 600)}.ledger h3:before{width:3px;height:12px;border-radius:2px;background:var(--studio-accent);content:"";opacity:.75}.ledger ul{margin:0;padding-left:18px}.ledger li+li{margin-top:3px}.artifact-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.artifact-stage-group{display:grid;gap:4px}.artifact-stage-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600)}.artifact-stage-heading span{font-weight:var(--font-weight-normal, 400)}.artifact-stage-items{display:grid;gap:4px;margin:0;padding:0;list-style:none}.artifact-stage-items .empty-item{margin-left:0}.artifact-button{display:grid;width:100%;min-width:0;padding:7px 8px;border:1px solid transparent;border-radius:7px;background:transparent;text-align:left;cursor:pointer}.artifact-button:hover,.artifact-button:focus-visible,.artifact-button[aria-current=true]{border-color:var(--studio-border);background:var(--studio-accent-soft)}.artifact-title,.artifact-list-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.artifact-title{font-weight:var(--font-weight-semibold, 600)}.artifact-list-meta{color:var(--text-color-muted, #656d76);font-family:var(--font-mono, "SFMono-Regular", Consolas, monospace);font-size:var(--text-code-inline, 12px)}.empty-item{list-style:none;margin-left:-18px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}@media(max-width:760px){html,body{overflow:auto}.app{height:auto;min-height:100%}.workspace{grid-template-columns:1fr;grid-template-rows:auto minmax(520px,65vh)}.splitter{display:none}.requirements{overflow:visible;border-bottom:1px solid var(--studio-border)}}@media(max-width:980px){.brand-subtitle,.reload-status{display:none}.design-tree-card{grid-template-columns:1fr;grid-template-rows:auto minmax(360px,1fr) auto;overflow:auto}.design-tree-body,.design-tree-inspector{grid-column:1}.design-tree-inspector{border-top:1px solid var(--border-color-default, #d0d7de);border-left:0}}\n';

// src/renderer/index.html
var renderer_default = '<!doctype html>\r\n<html lang="en">\r\n<head>\r\n  <meta charset="utf-8" />\r\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\r\n  <title>Tandem</title>\r\n  <style>__TANDEM_STYLES__</style>\r\n</head>\r\n<body>\r\n  <div class="app">\r\n    <header class="topbar">\r\n      <div class="brand">\r\n        <div class="mark" aria-hidden="true">T</div>\r\n        <div class="brand-copy">\r\n          <h1>Tandem</h1>\r\n          <span class="brand-subtitle">Lifecycle design workspace</span>\r\n        </div>\r\n      </div>\r\n      <div class="topbar-actions">\r\n        <span\r\n          id="next-action-guide"\r\n          class="visually-hidden"\r\n          role="status"\r\n          aria-live="polite"\r\n        ></span>\r\n        <div class="lifecycle" aria-label="Development lifecycle">\r\n          <span id="current-stage" class="stage" aria-label="Current lifecycle stage">\r\n            <span id="current-stage-index" class="stage-index" aria-hidden="true">1</span>\r\n            <span id="stage">Requirements</span>\r\n          </span>\r\n          <span id="phase" class="phase">Discovery</span>\r\n        </div>\r\n        <div class="reload-control">\r\n          <button id="reload-extension" class="reload-button" type="button">\r\n            Reload latest installed\r\n          </button>\r\n          <span id="reload-status" class="reload-status" role="status" aria-live="polite"></span>\r\n        </div>\r\n      </div>\r\n    </header>\r\n\r\n    <main id="studio-workspace" class="workspace">\r\n      <aside id="requirements-pane" class="requirements" aria-label="Prototype requirements">\r\n        <section class="section">\r\n          <p class="eyebrow">Goal</p>\r\n          <p id="goal" class="goal muted">Waiting for a prototype goal...</p>\r\n          <p id="status" class="status"></p>\r\n        </section>\r\n\r\n        <section class="section">\r\n          <p class="eyebrow">Stages</p>\r\n          <ol id="stage-list" class="stage-list"></ol>\r\n          <button id="complete-stage" class="complete-stage" type="button">\r\n            Finish requirements\r\n          </button>\r\n          <p id="stage-message" class="stage-message" role="status" aria-live="polite"></p>\r\n        </section>\r\n\r\n        <section class="section">\r\n          <p class="eyebrow">Artifacts</p>\r\n          <div id="artifact-list" class="artifact-list"></div>\r\n        </section>\r\n\r\n        <details class="section ledger-details">\r\n          <summary class="eyebrow ledger-summary">Requirement ledger</summary>\r\n          <div class="ledger">\r\n            <div>\r\n              <h3>Confirmed</h3>\r\n              <ul id="confirmed"></ul>\r\n            </div>\r\n            <div>\r\n              <h3>Assumed</h3>\r\n              <ul id="assumed"></ul>\r\n            </div>\r\n            <div>\r\n              <h3>Deferred</h3>\r\n              <ul id="deferred"></ul>\r\n            </div>\r\n          </div>\r\n        </details>\r\n      </aside>\r\n\r\n      <div\r\n        id="studio-splitter"\r\n        class="splitter"\r\n        role="separator"\r\n        aria-label="Resize requirements and output panels"\r\n        aria-orientation="vertical"\r\n        aria-controls="requirements-pane preview-pane"\r\n        aria-valuemin="280"\r\n        aria-valuenow="280"\r\n        tabindex="0"\r\n        title="Drag or use Left and Right arrow keys to resize"\r\n      ></div>\r\n\r\n      <section id="preview-pane" class="preview" aria-label="Prototype output">\r\n        <div class="previewbar">\r\n          <div class="preview-tabs" role="tablist" aria-label="Prototype output">\r\n            <button\r\n              id="design-tree-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="design-tree-panel"\r\n              tabindex="-1"\r\n              data-tab="design-tree"\r\n            >Requirements</button>\r\n            <button\r\n              id="live-preview-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="true"\r\n              aria-controls="live-preview-panel"\r\n              data-tab="preview"\r\n            >Live prototype</button>\r\n            <button\r\n              id="design-review-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="design-review-panel"\r\n              tabindex="-1"\r\n              data-tab="design-review"\r\n            >Design review <span id="review-count" class="artifact-count"></span></button>\r\n            <button\r\n              id="plan-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="plan-panel"\r\n              tabindex="-1"\r\n              data-tab="plan"\r\n              hidden\r\n            >Execution plan</button>\r\n            <button\r\n              id="implementation-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="implementation-panel"\r\n              tabindex="-1"\r\n              data-tab="implementation"\r\n              hidden\r\n            >Implementation</button>\r\n            <button\r\n              id="test-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="test-panel"\r\n              tabindex="-1"\r\n              data-tab="test"\r\n              hidden\r\n            >Tests</button>\r\n            <button\r\n              id="content-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="content-panel"\r\n              tabindex="-1"\r\n              data-tab="content"\r\n            >Content <span id="artifact-count" class="artifact-count"></span></button>\r\n          </div>\r\n          <div id="preview-tools" class="preview-tools">\r\n            <span id="preview-status" class="preview-status">Waiting</span>\r\n            <a id="open-preview" class="open-preview" target="_blank" rel="noreferrer">Open separately</a>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="live-preview-panel"\r\n          class="frame-wrap"\r\n          role="tabpanel"\r\n          aria-labelledby="live-preview-tab"\r\n        >\r\n          <div class="preview-surface">\r\n            <div\r\n              id="prototype-building"\r\n              class="prototype-building"\r\n              role="status"\r\n              aria-live="polite"\r\n              aria-atomic="true"\r\n              hidden\r\n            >\r\n              <div class="prototype-building-card">\r\n                <span class="processing-indicator" aria-hidden="true"></span>\r\n                <span class="processing-copy">\r\n                  <span class="processing-heading">\r\n                    <strong>Building runnable prototype</strong>\r\n                    <span class="processing-dots" aria-hidden="true"><i></i><i></i><i></i></span>\r\n                  </span>\r\n                  <span id="prototype-building-message" class="muted"></span>\r\n                </span>\r\n              </div>\r\n            </div>\r\n            <div id="preview-empty" class="preview-empty">\r\n              <p>The runnable prototype will appear here after the essential interaction decisions are captured.</p>\r\n            </div>\r\n            <iframe\r\n              id="preview-frame"\r\n              title="Runnable prototype"\r\n              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"\r\n            ></iframe>\r\n          </div>\r\n          <section id="prototype-review" class="prototype-review" hidden>\r\n            <div class="prototype-review-heading">\r\n              <strong>Suggest a prototype revision</strong>\r\n              <span>Iterate until no more changes are needed</span>\r\n            </div>\r\n            <form id="revision-form" class="revision-form">\r\n              <textarea\r\n                id="revision-input"\r\n                maxlength="4000"\r\n                placeholder="Describe one change you want to see in the prototype."\r\n                aria-label="Prototype revision suggestion"\r\n              ></textarea>\r\n              <button id="submit-revision" type="submit">Send revision</button>\r\n            </form>\r\n            <div id="revision-question" class="revision-question" hidden>\r\n              <p id="revision-question-title" class="revision-question-title"></p>\r\n              <p id="revision-question-rationale" class="rationale"></p>\r\n              <form id="revision-question-form" class="revision-question-form">\r\n                <div id="revision-question-choices" class="revision-question-choices"></div>\r\n                <textarea\r\n                  id="revision-question-detail"\r\n                  maxlength="4000"\r\n                  placeholder="Optional clarification"\r\n                  aria-label="Prototype clarification"\r\n                ></textarea>\r\n                <button id="submit-clarification" type="submit">Use this answer</button>\r\n              </form>\r\n            </div>\r\n            <ul id="revision-history" class="revision-history"></ul>\r\n            <p id="revision-status" class="revision-status" role="status" aria-live="polite"></p>\r\n          </section>\r\n        </div>\r\n        <div\r\n          id="plan-panel"\r\n          class="plan-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="plan-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <div class="plan-workspace">\r\n            <div class="plan-heading">\r\n              <div class="plan-heading-copy">\r\n                <strong>Implementation orchestration</strong>\r\n                <span id="plan-progress">Generate work items, schedule waves, and agent assignments.</span>\r\n              </div>\r\n              <div class="plan-controls">\r\n                <label class="plan-agent-limit">\r\n                  Max agents\r\n                  <input id="plan-max-agents" type="number" min="1" max="30" value="4" />\r\n                </label>\r\n                <button id="generate-plan" class="plan-button" type="button">\r\n                  Generate plan\r\n                </button>\r\n                <button id="finalize-plan" class="plan-button secondary" type="button">\r\n                  Finalize plan\r\n                </button>\r\n              </div>\r\n            </div>\r\n            <div id="plan-metrics" class="plan-metrics"></div>\r\n            <section id="plan-strategy-section" class="plan-section" hidden>\r\n              <h3>Orchestration strategy</h3>\r\n              <p id="plan-strategy" class="plan-strategy"></p>\r\n            </section>\r\n            <section id="plan-dag-section" class="plan-section" hidden>\r\n              <h3>Dependency DAG</h3>\r\n              <div id="plan-dag" class="mermaid-host" role="img" aria-label="Execution plan dependency graph"></div>\r\n              <p id="plan-dag-status" class="diagram-status" role="status" aria-live="polite"></p>\r\n            </section>\r\n            <div id="plan-columns" class="plan-columns" hidden>\r\n              <div class="plan-main">\r\n                <section class="plan-section">\r\n                  <h3>Parallel schedule</h3>\r\n                  <div id="plan-waves" class="plan-waves"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Implementation work items</h3>\r\n                  <div id="plan-work-items" class="plan-work-items"></div>\r\n                </section>\r\n              </div>\r\n              <aside class="plan-sidebar">\r\n                <section class="plan-section">\r\n                  <h3>Agent workload</h3>\r\n                  <div id="plan-agents" class="plan-agents"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Risks and coordination</h3>\r\n                  <ul id="plan-risks" class="plan-risks"></ul>\r\n                </section>\r\n              </aside>\r\n            </div>\r\n            <section id="plan-revision-section" class="plan-section" hidden>\r\n              <h3>Revise execution plan</h3>\r\n              <form id="plan-revision-form" class="plan-revision-form">\r\n                <textarea\r\n                  id="plan-revision-input"\r\n                  maxlength="4000"\r\n                  placeholder="Describe how assignments, dependencies, work-item scope, or schedule should change."\r\n                  aria-label="Execution plan revision"\r\n                ></textarea>\r\n                <div class="plan-actions">\r\n                  <span id="plan-status" class="plan-status" role="status" aria-live="polite"></span>\r\n                  <button id="optimize-plan" class="plan-button secondary" type="button">\r\n                    Optimize parallelism\r\n                  </button>\r\n                  <button id="revise-plan" class="plan-button" type="submit">\r\n                    Revise plan\r\n                  </button>\r\n                </div>\r\n              </form>\r\n            </section>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="implementation-panel"\r\n          class="implementation-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="implementation-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <div class="implementation-workspace">\r\n            <div class="implementation-heading">\r\n              <div class="implementation-heading-copy">\r\n                <strong>Development execution</strong>\r\n                <span id="implementation-progress">Ready to assign the finalized work items.</span>\r\n              </div>\r\n              <div class="implementation-controls">\r\n                <button id="start-implementation" class="plan-button" type="button">\r\n                  Start implementation\r\n                </button>\r\n                <button id="stop-implementation" class="plan-button secondary" type="button" hidden>\r\n                  Stop run\r\n                </button>\r\n              </div>\r\n            </div>\r\n            <section class="plan-section">\r\n              <div class="implementation-progress-copy">\r\n                <strong>Overall progress</strong>\r\n                <span id="implementation-progress-label" class="implementation-meta">0 of 0 complete</span>\r\n              </div>\r\n              <div class="implementation-progress-track" aria-hidden="true">\r\n                <div id="implementation-progress-bar" class="implementation-progress-bar"></div>\r\n              </div>\r\n            </section>\r\n            <div id="implementation-metrics" class="plan-metrics"></div>\r\n            <div class="implementation-grid">\r\n              <div class="implementation-main">\r\n                <section class="plan-section">\r\n                  <h3>Execution waves</h3>\r\n                  <div id="implementation-waves" class="implementation-list"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Work items</h3>\r\n                  <div id="implementation-work-items" class="implementation-list"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Agent activity</h3>\r\n                  <div id="implementation-agents" class="implementation-agents"></div>\r\n                </section>\r\n              </div>\r\n              <aside class="implementation-sidebar">\r\n                <section class="plan-section">\r\n                  <h3>Adjust execution strategy</h3>\r\n                  <form id="implementation-strategy-form" class="implementation-strategy-form">\r\n                    <textarea\r\n                      id="implementation-strategy-input"\r\n                      maxlength="4000"\r\n                      placeholder="Change priority, validation depth, coordination, or guidance for the next wave."\r\n                      aria-label="Implementation strategy adjustment"\r\n                    ></textarea>\r\n                    <div class="plan-actions">\r\n                      <span id="implementation-status" class="implementation-status" role="status" aria-live="polite"></span>\r\n                      <button id="submit-implementation-strategy" class="plan-button" type="submit">\r\n                        Queue adjustment\r\n                      </button>\r\n                    </div>\r\n                  </form>\r\n                  <div id="implementation-strategies" class="implementation-strategies"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Recent activity</h3>\r\n                  <div id="implementation-events" class="implementation-events"></div>\r\n                </section>\r\n              </aside>\r\n            </div>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="test-panel"\r\n          class="implementation-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="test-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <div class="implementation-workspace">\r\n            <div class="implementation-heading">\r\n              <div class="implementation-heading-copy">\r\n                <strong>Integration and interaction tests</strong>\r\n                <span id="test-progress">Ready to execute the approved test specification.</span>\r\n              </div>\r\n              <button id="start-tests" class="plan-button" type="button">\r\n                Run tests\r\n              </button>\r\n            </div>\r\n            <section class="plan-section">\r\n              <div class="implementation-progress-copy">\r\n                <strong>Overall progress</strong>\r\n                <span id="test-progress-label" class="implementation-meta">0 of 0 passed</span>\r\n              </div>\r\n              <div class="implementation-progress-track" aria-hidden="true">\r\n                <div id="test-progress-bar" class="implementation-progress-bar"></div>\r\n              </div>\r\n            </section>\r\n            <div id="test-metrics" class="plan-metrics"></div>\r\n            <div class="implementation-grid">\r\n              <div class="implementation-main">\r\n                <section class="plan-section">\r\n                  <h3>Test scenarios</h3>\r\n                  <div id="test-scenarios" class="implementation-list"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Test agents</h3>\r\n                  <div id="test-agents" class="implementation-agents"></div>\r\n                </section>\r\n              </div>\r\n              <aside class="implementation-sidebar">\r\n                <section class="plan-section">\r\n                  <h3>Recent test activity</h3>\r\n                  <div id="test-events" class="implementation-events"></div>\r\n                  <p id="test-status" class="implementation-status" role="status" aria-live="polite"></p>\r\n                </section>\r\n              </aside>\r\n            </div>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="design-review-panel"\r\n          class="design-review-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="design-review-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <section class="design-review-card">\r\n            <div class="design-review-heading">\r\n              <div class="design-review-title">\r\n                <ol class="design-substages" aria-label="Design substages">\r\n                  <li id="product-design-substage" class="design-substage">1 \xB7 Product design</li>\r\n                  <li id="test-design-substage" class="design-substage">2 \xB7 Test design</li>\r\n                </ol>\r\n                <strong id="design-review-title">Product design review</strong>\r\n                <span id="design-review-progress">Ask questions and resolve the answers.</span>\r\n              </div>\r\n              <button id="finish-review" class="finish-review" type="button">\r\n                No more questions\r\n              </button>\r\n            </div>\r\n            <div id="design-review-threads" class="design-review-threads"></div>\r\n          </section>\r\n        </div>\r\n        <div\r\n          id="design-tree-panel"\r\n          class="design-tree-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="design-tree-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <section\r\n            id="requirements-substage-section"\r\n            class="section requirements-intake-panel"\r\n          >\r\n            <p class="eyebrow">Requirements</p>\r\n            <ol class="requirements-substages" aria-label="Requirements substages">\r\n              <li id="usage-substage" class="requirements-substage">\r\n                <span class="requirements-substage-index">1</span>\r\n                <span>Usage list</span>\r\n              </li>\r\n              <li id="dag-substage" class="requirements-substage">\r\n                <span class="requirements-substage-index">2</span>\r\n                <span>Decision DAG</span>\r\n              </li>\r\n            </ol>\r\n            <div id="usage-intake">\r\n              <p class="usage-intro">\r\n                How do you want to use the app? Add one sentence for each usage.\r\n              </p>\r\n              <ul id="usage-items" class="usage-items"></ul>\r\n              <form id="usage-form" class="usage-form">\r\n                <input\r\n                  id="usage-input"\r\n                  type="text"\r\n                  maxlength="500"\r\n                  autocomplete="off"\r\n                  placeholder="I want to..."\r\n                  aria-label="Add one app usage"\r\n                />\r\n                <button id="add-usage" type="submit">Add usage</button>\r\n              </form>\r\n              <div id="usage-suggestion-area" hidden>\r\n                <p class="usage-suggestion-heading">AI suggestions \u2014 click to add</p>\r\n                <ul id="usage-suggestions" class="usage-suggestions"></ul>\r\n              </div>\r\n              <button id="generate-dag" class="generate-dag" type="button">\r\n                Generate requirements DAG\r\n              </button>\r\n            </div>\r\n            <p id="usage-message" class="usage-message" role="status" aria-live="polite"></p>\r\n          </section>\r\n          <div id="design-tree-card" class="design-tree-card" hidden>\r\n            <div class="design-tree-heading">\r\n              <div class="design-tree-location">\r\n                <span>You are here</span>\r\n                <strong id="design-tree-current">Waiting for the active decision...</strong>\r\n              </div>\r\n              <span id="design-tree-phase" class="design-tree-phase">Discovery</span>\r\n            </div>\r\n            <div class="design-tree-body">\r\n              <div class="design-tree-legend" aria-label="Decision status legend">\r\n                <span><i class="answered" aria-hidden="true"></i>Answered</span>\r\n                <span><i class="active" aria-hidden="true"></i>Active</span>\r\n                <span><i class="to-answer" aria-hidden="true"></i>To answer</span>\r\n              </div>\r\n              <div\r\n                id="design-tree-host"\r\n                class="mermaid-host design-tree-host"\r\n                role="img"\r\n                aria-label="Requirements decision DAG"\r\n              ></div>\r\n              <p id="design-tree-status" class="diagram-status" role="status" aria-live="polite"></p>\r\n              <details id="design-tree-source-details" class="diagram-source">\r\n                <summary>Mermaid source</summary>\r\n                <pre id="design-tree-source"></pre>\r\n              </details>\r\n            </div>\r\n            <aside class="design-tree-inspector" aria-label="Selected decision">\r\n              <p class="eyebrow">Selected question</p>\r\n              <div id="question-host" class="question-card">\r\n                <p class="muted">The active decision will appear here.</p>\r\n              </div>\r\n            </aside>\r\n          </div>\r\n          <div id="design-tree-empty" class="content-empty">\r\n            <p>The requirements DAG will appear after the usage list is captured.</p>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="content-panel"\r\n          class="content-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="content-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <div id="content-card" class="content-card" hidden>\r\n            <div class="content-heading">\r\n              <strong id="artifact-heading">Artifact content</strong>\r\n              <span id="artifact-meta" class="artifact-meta"></span>\r\n            </div>\r\n            <div class="artifact-body">\r\n              <div id="artifact-diagram" class="artifact-diagram" hidden>\r\n                <div\r\n                  id="mermaid-host"\r\n                  class="mermaid-host"\r\n                  role="img"\r\n                  aria-label="Workflow diagram"\r\n                ></div>\r\n                <p id="diagram-status" class="diagram-status" role="status" aria-live="polite"></p>\r\n                <details id="diagram-source-details" class="diagram-source">\r\n                  <summary>Mermaid source</summary>\r\n                  <pre id="mermaid-source"></pre>\r\n                </details>\r\n              </div>\r\n              <pre id="artifact-content" class="artifact-content"></pre>\r\n              <section id="artifact-review" class="artifact-review" hidden>\r\n                <div class="artifact-review-heading">\r\n                  <strong>Artifact review</strong>\r\n                  <span>Questions and review decisions stay with this artifact.</span>\r\n                </div>\r\n                <div id="artifact-review-threads" class="artifact-review-threads"></div>\r\n                <form id="design-review-form" class="design-review-composer">\r\n                  <select\r\n                    id="review-request-kind"\r\n                    class="review-request-kind"\r\n                    aria-label="Artifact review request type"\r\n                  >\r\n                    <option value="question">Ask about this artifact</option>\r\n                    <option value="diagram">Generate a related diagram</option>\r\n                    <option value="contract">Generate a related contract</option>\r\n                    <option value="decision-record">Generate a related decision record</option>\r\n                    <option value="test-scenario">Generate a related test scenario</option>\r\n                  </select>\r\n                  <textarea\r\n                    id="design-review-input"\r\n                    maxlength="4000"\r\n                    placeholder="Ask about this artifact, its tradeoffs, behavior, or risks."\r\n                    aria-label="Artifact review question or request"\r\n                  ></textarea>\r\n                  <div class="review-composer-actions">\r\n                    <span id="design-review-status" class="design-review-status" role="status" aria-live="polite"></span>\r\n                    <button id="review-submit" class="review-submit" type="submit">\r\n                      Ask question\r\n                    </button>\r\n                  </div>\r\n                </form>\r\n              </section>\r\n            </div>\r\n          </div>\r\n          <div id="content-empty" class="content-empty">\r\n            <p>Captured artifacts will appear here as the prototype evolves.</p>\r\n          </div>\r\n        </div>\r\n      </section>\r\n    </main>\r\n  </div>\r\n\r\n  <script>__TANDEM_CLIENT__</script>\r\n</body>\r\n</html>\r\n';

// src/renderer.ts
var STYLES_TOKEN = "__TANDEM_STYLES__";
var CLIENT_TOKEN = "__TANDEM_CLIENT__";
function injectAsset(template, token, content) {
  if (!template.includes(token)) {
    throw new Error(`Tandem renderer template is missing ${token}.`);
  }
  return template.replace(token, content);
}
function renderTandemHtml() {
  const withStyles = injectAsset(renderer_default, STYLES_TOKEN, styles_default);
  return injectAsset(withStyles, CLIENT_TOKEN, client_default);
}

// src/extension.ts
var CANVAS_ID = "tandem";
var DEFAULT_PROTOTYPE_ID = "active";
var USER_EXTENSION_ID = "user:tandem";
var PROJECT_EXTENSION_ID = "project:tandem";
var MAX_REQUEST_BYTES = 32 * 1024;
var PROCESS_STARTED_AT = Date.now();
var WORKSPACE_ROOT = process.cwd();
var SHARED_PROJECT_ROOT = resolveSharedProjectRoot();
var STATE_DIRECTORY = join(SHARED_PROJECT_ROOT, ".tandem");
var CURRENT_STATE_PATH = join(STATE_DIRECTORY, "current.json");
var LEGACY_STATE_DIRECTORY = join(
  SHARED_PROJECT_ROOT,
  [".intent", "studio"].join("")
);
var LEGACY_CURRENT_STATE_PATH = join(LEGACY_STATE_DIRECTORY, "current.json");
var PREVIEW_IDENTITY_MARKERS = /* @__PURE__ */ new Set([
  "tandem-prototype-id",
  ["fast", "prototype", "id"].join("-")
]);
var LIFECYCLE_STAGES = [
  { id: "requirements", label: "Requirements" },
  { id: "prototype", label: "Prototype" },
  { id: "design", label: "Design" },
  { id: "plan", label: "Plan" },
  { id: "implement", label: "Implement" },
  { id: "test", label: "Test" }
];
var PROVIDER_SCOPE = providerScopeFromModuleUrl(import.meta.url);
var ANSWER_FACTORY_NAME = `tandem-process-answer-${PROVIDER_SCOPE}`;
var SUGGESTION_FACTORY_NAME = `tandem-generate-usage-suggestions-${PROVIDER_SCOPE}`;
var DESIGN_REVIEW_FACTORY_NAME = `tandem-design-review-${PROVIDER_SCOPE}`;
var PLANNING_FACTORY_NAME = `tandem-execution-planning-${PROVIDER_SCOPE}`;
var IMPLEMENTATION_FACTORY_NAME = `tandem-implementation-orchestrator-${PROVIDER_SCOPE}`;
var TEST_FACTORY_NAME = `tandem-integration-interaction-tests-${PROVIDER_SCOPE}`;
var USAGE_QUESTION_ID = "usage-intake";
var ANSWER_ACTIONS = /* @__PURE__ */ new Set([
  "add-usage",
  "generate-dag",
  "answer-decision",
  "change-answer",
  "submit-revision",
  "clarify-revision",
  "generate-design-spec"
]);
var PROCESSING_MESSAGES = {
  "add-usage": "Saving the usage and generating complementary suggestions.",
  "generate-dag": "Analyzing usages and building the dependency-aware requirements DAG.",
  "answer-decision": "Recording the answer and recomputing dependent decisions.",
  "change-answer": "Regenerating every downstream decision affected by this answer.",
  "submit-revision": "Reviewing the requested prototype behavior and interaction changes.",
  "clarify-revision": "Applying the clarification to the active prototype revision.",
  "generate-design-spec": "Synthesizing confirmed requirements and prototype evidence."
};
var DEFAULT_PRODUCT_DESIGN_REQUESTS = [
  {
    id: "default-project-architecture",
    artifactKind: "diagram",
    prompt: "Inspect this project and generate the architecture and primary interaction-flow diagrams required for implementation. Tailor them to the accepted requirements, runnable prototype, draft feature specification, and existing repository; omit diagrams that do not add value for this project."
  },
  {
    id: "default-project-contracts",
    artifactKind: "contract",
    prompt: "Inspect this project and generate the implementation-facing UI, state, data, and integration contracts it actually requires. Capture boundaries, inputs and outputs, events, validation, and failure behavior without inventing unnecessary infrastructure."
  },
  {
    id: "default-project-decisions",
    artifactKind: "decision-record",
    prompt: "Inspect this project and record its implementation-critical design decisions, alternatives, tradeoffs, and risks. Include only decisions that should be reviewed before execution planning."
  }
];
var PROVIDER_EXTENSION_ID = PROVIDER_SCOPE === "user" ? USER_EXTENSION_ID : PROVIDER_SCOPE === "project" ? PROJECT_EXTENSION_ID : `session:tandem`;
var servers = /* @__PURE__ */ new Map();
var instancePrototypeIds = /* @__PURE__ */ new Map();
var stateCache = /* @__PURE__ */ new Map();
var writeQueues = /* @__PURE__ */ new Map();
var activeAnswerRuns = /* @__PURE__ */ new Map();
var activeSuggestionRuns = /* @__PURE__ */ new Map();
var activeDesignReviewRuns = /* @__PURE__ */ new Map();
var activePlanningRuns = /* @__PURE__ */ new Map();
var activeImplementationRuns = /* @__PURE__ */ new Map();
var activeTestRuns = /* @__PURE__ */ new Map();
var activePrototypeCompletions = /* @__PURE__ */ new Set();
var answerClaims = /* @__PURE__ */ new Map();
var session;
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
var AnswerRequestError = class extends Error {
  statusCode;
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
};
async function logSafely(message, level = "error") {
  try {
    await session.log(message, { level });
  } catch (error) {
    console.error(
      `${message} Logging also failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function resolveSharedProjectRoot() {
  const cwd = process.cwd();
  const options = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  };
  try {
    const commonValue = execFileSync(
      "git",
      ["rev-parse", "--git-common-dir"],
      options
    ).trim();
    const commonDirectory = resolve(cwd, commonValue);
    if (basename(commonDirectory).toLowerCase() === ".git") {
      return dirname(commonDirectory);
    }
    return execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      options
    ).trim() || cwd;
  } catch {
    return cwd;
  }
}
function providerScopeFromModuleUrl(moduleUrl) {
  const normalized = moduleUrl.toLowerCase();
  if (normalized.includes("/.github/extensions/")) return "project";
  if (normalized.includes("/.copilot/extensions/")) return "user";
  return "session";
}
function normalizePrototypeId(value) {
  const normalized = String(value || DEFAULT_PROTOTYPE_ID).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return normalized || DEFAULT_PROTOTYPE_ID;
}
function createState(prototypeId, goal = "") {
  return {
    version: 1,
    prototypeId,
    stage: "requirements",
    lifecycle: {
      currentStage: "requirements",
      completedStages: [],
      outputs: []
    },
    goal,
    phase: "discovery",
    status: "Describe how you want to use the app, one usage per sentence.",
    requirements: {
      substage: "usage",
      usageItems: [],
      suggestions: []
    },
    question: usageQuestion([]),
    decisionGraph: { nodes: [] },
    confirmed: [],
    assumed: [],
    deferred: [],
    artifacts: [],
    previewUrl: null,
    previewStatus: "waiting",
    prototypeReview: {
      revisions: [],
      activeRevisionId: null,
      question: null,
      evidence: [],
      designSpecArtifactId: null
    },
    designReview: {
      threads: [],
      processing: null,
      finalizeRequested: false,
      finalizedArtifactId: null
    },
    design: {
      substage: "product"
    },
    testDesignReview: {
      threads: [],
      processing: null,
      finalizeRequested: false,
      finalizedArtifactId: null,
      scenarios: []
    },
    planning: {
      status: "idle",
      summary: "",
      strategy: "",
      maxAgents: 4,
      workItems: [],
      waves: [],
      agents: [],
      risks: [],
      revisionHistory: [],
      metrics: {
        totalEffortHours: 0,
        scheduledHours: 0,
        criticalPathHours: 0,
        parallelismSavingsHours: 0,
        maxParallelism: 0
      },
      processing: null,
      finalizedArtifactId: null,
      error: ""
    },
    implementation: {
      status: "idle",
      runId: null,
      currentWaveIndex: 0,
      workItems: [],
      agents: [],
      strategySuggestions: [],
      events: [],
      startedAt: null,
      completedAt: null,
      finalizedArtifactId: null,
      error: ""
    },
    testing: {
      status: "idle",
      runId: null,
      currentWaveIndex: 0,
      scenarios: [],
      agents: [],
      events: [],
      startedAt: null,
      completedAt: null,
      finalizedArtifactId: null,
      error: ""
    },
    processing: null,
    suggestionProcessing: null,
    reloadReceipt: null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function stateFilePath(prototypeId) {
  return join(
    STATE_DIRECTORY,
    `${normalizePrototypeId(prototypeId)}.json`
  );
}
function legacyStateFilePaths(prototypeId) {
  const fileName = `${normalizePrototypeId(prototypeId)}.json`;
  const paths = [join(LEGACY_STATE_DIRECTORY, fileName)];
  if (session?.workspacePath) {
    paths.push(
      join(session.workspacePath, "files", "tandem", fileName),
      join(
        session.workspacePath,
        "files",
        ["fast", "prototyping"].join("-"),
        fileName
      )
    );
  }
  return paths;
}
async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}
`, "utf8");
  await rename(temporaryPath, path);
}
async function loadCurrentPrototypeId() {
  for (const path of [CURRENT_STATE_PATH, LEGACY_CURRENT_STATE_PATH]) {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (typeof value.prototypeId === "string") {
        return normalizePrototypeId(value.prototypeId);
      }
    } catch {
    }
  }
  return null;
}
async function persistCurrentPrototypeId(prototypeId) {
  await mkdir(STATE_DIRECTORY, { recursive: true });
  await writeJsonAtomically(CURRENT_STATE_PATH, {
    version: 1,
    prototypeId: normalizePrototypeId(prototypeId),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 50);
}
function inferArtifactStage(artifact, fallbackStage = "requirements") {
  if (LIFECYCLE_STAGES.some((stage) => stage.id === artifact.stage)) {
    return artifact.stage;
  }
  const id = String(artifact.id || "").toLowerCase();
  const kind = String(artifact.kind || "").toLowerCase();
  if (id === "draft-feature-spec" || ["feature-spec", "prototype", "prototype-evidence"].includes(kind)) {
    return "prototype";
  }
  if (id === "design-review" || id === "design-spec" || id === "test-spec" || [
    "design-review",
    "design-spec",
    "test-spec",
    "test-scenario",
    "architecture",
    "contract"
  ].includes(kind)) {
    return "design";
  }
  if (id === "implementation-plan" || ["implementation-plan", "execution-plan"].includes(kind)) {
    return "plan";
  }
  if (id === "final-code" || ["final-code", "implementation-result", "code"].includes(kind)) {
    return "implement";
  }
  if (id === "test-results" || ["test-results", "integration-test-results", "interaction-test-results"].includes(
    kind
  )) {
    return "test";
  }
  if (id === "user-intents" || id === "design-tree" || ["intent", "requirements", "data-model", "interaction-flow"].includes(kind)) {
    return "requirements";
  }
  return LIFECYCLE_STAGES.some((stage) => stage.id === fallbackStage) ? fallbackStage : "requirements";
}
function normalizeRequirements(value, decisionGraph = { nodes: [] }) {
  const fallbackSubstage = Array.isArray(decisionGraph.nodes) && decisionGraph.nodes.length > 0 ? "dag" : "usage";
  const substage = isObject(value) && ["usage", "dag"].includes(value.substage) ? value.substage : fallbackSubstage;
  const usageItems = normalizeStringList(
    isObject(value) ? value.usageItems : []
  ).map((item) => item.slice(0, 500)).slice(0, 30);
  const normalizedUsage = new Set(usageItems.map((item) => item.toLowerCase()));
  const suggestions = normalizeStringList(
    isObject(value) ? value.suggestions : []
  ).map((item) => item.slice(0, 500)).filter((item) => !normalizedUsage.has(item.toLowerCase())).slice(0, 6);
  return { substage, usageItems, suggestions };
}
function usageQuestion(suggestions) {
  return {
    id: USAGE_QUESTION_ID,
    text: "How do you want to use this app?",
    rationale: "Add one sentence for each usage. Suggestions adapt as you add more.",
    choices: normalizeStringList(suggestions).slice(0, 6),
    recommended: null,
    allowFreeText: true,
    answerPlaceholder: "For example: I want to triage incoming requests."
  };
}
function normalizeArtifacts(value, fallbackStage = "requirements") {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((artifact, index) => {
    if (!isObject(artifact)) return null;
    const path = String(artifact.path || "").trim().slice(0, 500);
    const id = String(artifact.id || path || `artifact-${index + 1}`).trim().slice(0, 120);
    const title = String(artifact.title || path || id).trim().slice(0, 200);
    if (!id || !title) return null;
    const kind = String(artifact.kind || "artifact").trim().slice(0, 80);
    const stage = inferArtifactStage(artifact, fallbackStage);
    return {
      id,
      title,
      kind,
      stage,
      path: !path && stage === "implement" && (id === "final-code" || kind === "final-code") ? "." : path,
      language: String(artifact.language || "markdown").trim().slice(0, 80),
      content: String(artifact.content || "").slice(0, 2e5),
      mermaid: String(artifact.mermaid || "").trim().slice(0, 5e4),
      sourceThreadIds: normalizeStringList(
        artifact.sourceThreadIds
      ).slice(0, 50),
      reviewStatus: ["current", "stale"].includes(
        artifact.reviewStatus
      ) ? artifact.reviewStatus : "current"
    };
  }).filter(Boolean);
}
function normalizeTestScenarios(value) {
  if (!Array.isArray(value)) return [];
  const scenarios = [];
  const ids = /* @__PURE__ */ new Set();
  for (const [index, candidate] of value.slice(0, 30).entries()) {
    if (!isObject(candidate)) continue;
    const id = String(candidate.id || `test-${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
    const title = String(candidate.title || "").trim().slice(0, 300);
    const description = String(candidate.description || "").trim().slice(0, 4e3);
    if (!id || ids.has(id) || !title || !description) continue;
    ids.add(id);
    scenarios.push({
      id,
      title,
      type: ["integration", "interaction"].includes(candidate.type) ? candidate.type : "interaction",
      description,
      dependencies: normalizeStringList(candidate.dependencies).slice(0, 20),
      steps: normalizeStringList(candidate.steps).slice(0, 30),
      expectedOutcome: String(candidate.expectedOutcome || "").trim().slice(0, 4e3),
      validation: normalizeStringList(candidate.validation).slice(0, 30)
    });
  }
  return scenarios.map((scenario) => ({
    ...scenario,
    dependencies: scenario.dependencies.filter(
      (dependency) => dependency !== scenario.id && ids.has(dependency)
    )
  }));
}
function normalizeDesignReview(value) {
  const threads = isObject(value) && Array.isArray(value.threads) ? value.threads.slice(-100).map((thread, index) => {
    if (!isObject(thread)) return null;
    const id = String(thread.id || `design-thread-${index + 1}`).trim().slice(0, 120);
    const prompt = String(thread.prompt || "").trim().slice(0, 4e3);
    if (!id || !prompt) return null;
    const type = ["question", "artifact"].includes(thread.type) ? thread.type : "question";
    return {
      id,
      type,
      artifactKind: [
        "diagram",
        "contract",
        "decision-record",
        "test-scenario"
      ].includes(thread.artifactKind) ? thread.artifactKind : null,
      prompt,
      answer: String(thread.answer || "").trim().slice(0, 2e4),
      status: [
        "queued",
        "processing",
        "answered",
        "resolved",
        "failed"
      ].includes(thread.status) ? thread.status : "queued",
      artifactIds: normalizeStringList(thread.artifactIds).slice(
        0,
        20
      ),
      reviewArtifactId: typeof thread.reviewArtifactId === "string" ? thread.reviewArtifactId.trim().slice(0, 120) || null : null,
      createdAt: String(thread.createdAt || ""),
      completedAt: thread.completedAt ? String(thread.completedAt) : null,
      error: String(thread.error || "").trim().slice(0, 1e3)
    };
  }).filter(Boolean) : [];
  const threadIds = new Set(threads.map((thread) => thread.id));
  const processing = isObject(value) && isObject(value.processing) && typeof value.processing.requestId === "string" ? {
    requestId: value.processing.requestId.trim().slice(0, 120),
    action: value.processing.action === "finalize" ? "finalize" : "process-thread",
    threadId: threadIds.has(value.processing.threadId) ? value.processing.threadId : null,
    runId: value.processing.runId ? String(value.processing.runId).trim().slice(0, 200) : null,
    requestedAt: String(value.processing.requestedAt || "")
  } : null;
  return {
    threads,
    processing: processing?.requestId && (processing.action === "finalize" || processing.threadId) ? processing : null,
    finalizeRequested: isObject(value) && value.finalizeRequested === true,
    finalizedArtifactId: isObject(value) && typeof value.finalizedArtifactId === "string" ? value.finalizedArtifactId.trim().slice(0, 120) || null : null,
    scenarios: normalizeTestScenarios(
      isObject(value) ? value.scenarios : []
    )
  };
}
function normalizeDesign(value, designReview) {
  const productComplete = ["design-spec", "design-review"].includes(
    designReview.finalizedArtifactId
  );
  return {
    substage: isObject(value) && ["product", "test"].includes(value.substage) ? value.substage : productComplete ? "test" : "product"
  };
}
function scheduleTestScenarios(scenarios, maxAgents = 4) {
  const scheduled = /* @__PURE__ */ new Set();
  const remaining = new Set(scenarios.map((scenario) => scenario.id));
  const waves = [];
  while (remaining.size > 0) {
    const ready = scenarios.filter(
      (scenario) => remaining.has(scenario.id) && scenario.dependencies.every(
        (dependency) => scheduled.has(dependency)
      )
    );
    if (ready.length === 0) {
      return {
        waves: [],
        error: "The test scenario dependency graph contains a cycle."
      };
    }
    const batch = ready.slice(0, maxAgents);
    waves.push({
      index: waves.length + 1,
      scenarioIds: batch.map((scenario) => scenario.id)
    });
    for (const scenario of batch) {
      remaining.delete(scenario.id);
      scheduled.add(scenario.id);
    }
  }
  return { waves, error: "" };
}
function normalizeTesting(value, testDesignReview) {
  const source = isObject(value) ? value : {};
  const runtimeById = new Map(
    (Array.isArray(source.scenarios) ? source.scenarios : []).filter((scenario) => isObject(scenario)).map((scenario) => [String(scenario.id || ""), scenario])
  );
  const scenarios = testDesignReview.scenarios.map((spec) => {
    const runtime = runtimeById.get(spec.id) || {};
    return {
      id: spec.id,
      status: ["pending", "running", "passed", "failed", "blocked"].includes(
        runtime.status
      ) ? runtime.status : "pending",
      summary: String(runtime.summary || "").trim().slice(0, 12e3),
      evidence: normalizeStringList(runtime.evidence).slice(0, 50),
      startedAt: runtime.startedAt ? String(runtime.startedAt) : null,
      completedAt: runtime.completedAt ? String(runtime.completedAt) : null
    };
  });
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const agents = (Array.isArray(source.agents) ? source.agents : []).slice(0, 30).map((agent) => {
    if (!isObject(agent)) return null;
    const scenarioId = String(agent.scenarioId || "").trim().slice(0, 120);
    if (!scenarioIds.has(scenarioId)) return null;
    return {
      id: String(agent.id || `test:${scenarioId}`).trim().slice(0, 120),
      scenarioId,
      status: String(agent.status || "pending").trim().slice(0, 80),
      activity: String(agent.activity || "").trim().slice(0, 1e3),
      summary: String(agent.summary || "").trim().slice(0, 8e3)
    };
  }).filter(Boolean);
  const events = (Array.isArray(source.events) ? source.events : []).slice(-200).map((event, index) => {
    if (!isObject(event)) return null;
    const message = String(event.message || "").trim().slice(0, 2e3);
    if (!message) return null;
    return {
      id: String(event.id || `test-event-${index + 1}`).trim().slice(0, 120),
      type: String(event.type || "info").trim().slice(0, 80),
      message,
      at: String(event.at || "")
    };
  }).filter(Boolean);
  return {
    status: ["idle", "starting", "running", "completed", "failed"].includes(
      source.status
    ) ? source.status : "idle",
    runId: typeof source.runId === "string" ? source.runId.trim().slice(0, 200) || null : null,
    currentWaveIndex: Math.max(
      0,
      Number.parseInt(source.currentWaveIndex, 10) || 0
    ),
    scenarios,
    agents,
    events,
    startedAt: source.startedAt ? String(source.startedAt) : null,
    completedAt: source.completedAt ? String(source.completedAt) : null,
    finalizedArtifactId: typeof source.finalizedArtifactId === "string" ? source.finalizedArtifactId.trim().slice(0, 120) || null : null,
    error: String(source.error || "").trim().slice(0, 2e3)
  };
}
function normalizePlanWorkItems(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  const ids = /* @__PURE__ */ new Set();
  for (const [index, candidate] of value.slice(0, 30).entries()) {
    if (!isObject(candidate)) continue;
    const id = String(candidate.id || `work-${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
    const title = String(candidate.title || "").trim().slice(0, 200);
    const description = String(candidate.description || "").trim().slice(0, 4e3);
    if (!id || !title || !description || ids.has(id)) continue;
    ids.add(id);
    items.push({
      id,
      title,
      description,
      dependencies: normalizeStringList(candidate.dependencies).slice(0, 30),
      agentRole: String(candidate.agentRole || "Implementation engineer").trim().slice(0, 120) || "Implementation engineer",
      agentId: String(candidate.agentId || "").trim().slice(0, 80),
      estimatedHours: Math.max(
        0.5,
        Math.min(80, Number(candidate.estimatedHours) || 1)
      ),
      files: normalizeStringList(candidate.files).map((path) => path.slice(0, 500)).slice(0, 50),
      skills: normalizeStringList(candidate.skills).map((skill) => skill.slice(0, 120)).slice(0, 20),
      acceptanceCriteria: normalizeStringList(candidate.acceptanceCriteria).map((criterion) => criterion.slice(0, 1e3)).slice(0, 30),
      validation: normalizeStringList(candidate.validation).map((step) => step.slice(0, 1e3)).slice(0, 20)
    });
  }
  const validIds = new Set(items.map((item) => item.id));
  return items.map((item) => ({
    ...item,
    dependencies: item.dependencies.filter(
      (dependency) => dependency !== item.id && validIds.has(dependency)
    )
  }));
}
function schedulePlanWorkItems(workItems, maxAgents) {
  const itemMap = new Map(
    workItems.map((item) => [item.id, { ...item, agentId: "" }])
  );
  const remaining = new Set(itemMap.keys());
  const completed = /* @__PURE__ */ new Set();
  const waves = [];
  const agents = /* @__PURE__ */ new Map();
  let startHour = 0;
  while (remaining.size > 0) {
    const ready = [...remaining].map((id) => itemMap.get(id)).filter(
      (item) => item.dependencies.every((dependency) => completed.has(dependency))
    ).sort(
      (left, right) => right.estimatedHours - left.estimatedHours || left.id.localeCompare(right.id)
    );
    if (ready.length === 0) {
      throw new Error("The execution plan contains a dependency cycle.");
    }
    const selected = [];
    const claimedFiles = /* @__PURE__ */ new Set();
    for (const item of ready) {
      if (selected.length >= maxAgents) break;
      const conflicts = item.files.some((path) => claimedFiles.has(path));
      if (conflicts) continue;
      selected.push(item);
      for (const path of item.files) claimedFiles.add(path);
    }
    if (selected.length === 0) selected.push(ready[0]);
    selected.forEach((item, index) => {
      const agentId = `agent-${index + 1}`;
      item.agentId = agentId;
      const current = agents.get(agentId) || {
        id: agentId,
        workItemIds: [],
        roles: [],
        estimatedHours: 0
      };
      current.workItemIds.push(item.id);
      if (!current.roles.includes(item.agentRole)) {
        current.roles.push(item.agentRole);
      }
      current.estimatedHours += item.estimatedHours;
      agents.set(agentId, current);
    });
    const durationHours = Math.max(
      ...selected.map((item) => item.estimatedHours)
    );
    waves.push({
      id: `wave-${waves.length + 1}`,
      index: waves.length + 1,
      workItemIds: selected.map((item) => item.id),
      startHour,
      endHour: startHour + durationHours,
      durationHours
    });
    startHour += durationHours;
    for (const item of selected) {
      remaining.delete(item.id);
      completed.add(item.id);
    }
  }
  const orderedItems = waves.flatMap(
    (wave) => wave.workItemIds.map((id) => itemMap.get(id))
  );
  const criticalFinish = /* @__PURE__ */ new Map();
  for (const item of orderedItems) {
    const dependencyFinish = item.dependencies.length > 0 ? Math.max(
      ...item.dependencies.map(
        (dependency) => criticalFinish.get(dependency) || 0
      )
    ) : 0;
    criticalFinish.set(
      item.id,
      dependencyFinish + item.estimatedHours
    );
  }
  const totalEffortHours = orderedItems.reduce(
    (total, item) => total + item.estimatedHours,
    0
  );
  const criticalPathHours = criticalFinish.size > 0 ? Math.max(...criticalFinish.values()) : 0;
  return {
    workItems: orderedItems,
    waves,
    agents: [...agents.values()],
    metrics: {
      totalEffortHours,
      scheduledHours: startHour,
      criticalPathHours,
      parallelismSavingsHours: Math.max(0, totalEffortHours - startHour),
      maxParallelism: waves.length > 0 ? Math.max(...waves.map((wave) => wave.workItemIds.length)) : 0
    }
  };
}
function normalizePlanning(value) {
  const source = isObject(value) ? value : {};
  const maxAgents = Math.max(
    1,
    Math.min(30, Number.parseInt(source.maxAgents, 10) || 4)
  );
  const rawItems = normalizePlanWorkItems(source.workItems);
  let schedule = {
    workItems: rawItems,
    waves: [],
    agents: [],
    metrics: {
      totalEffortHours: 0,
      scheduledHours: 0,
      criticalPathHours: 0,
      parallelismSavingsHours: 0,
      maxParallelism: 0
    }
  };
  let scheduleError = "";
  try {
    schedule = schedulePlanWorkItems(rawItems, maxAgents);
  } catch (error) {
    scheduleError = error instanceof Error ? error.message : String(error);
  }
  const processing = isObject(source.processing) && typeof source.processing.requestId === "string" && source.processing.requestId.trim() ? {
    requestId: source.processing.requestId.trim().slice(0, 120),
    action: source.processing.action === "revise" ? "revise" : "generate",
    instruction: String(source.processing.instruction || "").trim().slice(0, 4e3),
    runId: source.processing.runId ? String(source.processing.runId).trim().slice(0, 200) : null,
    requestedAt: String(source.processing.requestedAt || "")
  } : null;
  return {
    status: [
      "idle",
      "generating",
      "revising",
      "ready",
      "complete",
      "failed"
    ].includes(source.status) ? source.status : rawItems.length > 0 ? "ready" : "idle",
    summary: String(source.summary || "").trim().slice(0, 8e3),
    strategy: String(source.strategy || "").trim().slice(0, 8e3),
    maxAgents,
    ...schedule,
    risks: normalizeStringList(source.risks).map((risk) => risk.slice(0, 1e3)).slice(0, 50),
    revisionHistory: normalizeStringList(source.revisionHistory).map((entry) => entry.slice(0, 4e3)).slice(-30),
    processing,
    finalizedArtifactId: typeof source.finalizedArtifactId === "string" ? source.finalizedArtifactId.trim().slice(0, 120) || null : null,
    error: (scheduleError || String(source.error || "").trim()).slice(
      0,
      1e3
    )
  };
}
function normalizeImplementation(value, planning) {
  const source = isObject(value) ? value : {};
  const planItemIds = new Set(planning.workItems.map((item) => item.id));
  const rawWorkItems = Array.isArray(source.workItems) ? source.workItems : [];
  const runtimeById = new Map(
    rawWorkItems.filter(
      (item) => isObject(item) && planItemIds.has(String(item.id || ""))
    ).map((item) => [String(item.id), item])
  );
  const workItems = planning.workItems.map((planItem) => {
    const runtime = runtimeById.get(planItem.id) || {};
    return {
      id: planItem.id,
      status: [
        "pending",
        "running",
        "completed",
        "failed",
        "blocked",
        "cancelled"
      ].includes(runtime.status) ? runtime.status : "pending",
      agentId: String(runtime.agentId || planItem.agentId || "").trim().slice(0, 120),
      summary: String(runtime.summary || "").trim().slice(0, 12e3),
      filesChanged: normalizeStringList(runtime.filesChanged).map((path) => path.slice(0, 500)).slice(0, 100),
      validation: normalizeStringList(runtime.validation).map((entry) => entry.slice(0, 2e3)).slice(0, 50),
      blockers: normalizeStringList(runtime.blockers).map((entry) => entry.slice(0, 2e3)).slice(0, 50),
      startedAt: runtime.startedAt ? String(runtime.startedAt) : null,
      completedAt: runtime.completedAt ? String(runtime.completedAt) : null
    };
  });
  const agents = Array.isArray(source.agents) ? source.agents.slice(0, 100).map((agent) => {
    if (!isObject(agent)) return null;
    const id = String(agent.id || "").trim().slice(0, 120);
    const workItemId = String(agent.workItemId || "").trim().slice(0, 120);
    if (!id || !planItemIds.has(workItemId)) return null;
    return {
      id,
      workItemId,
      role: String(agent.role || "").trim().slice(0, 120),
      status: String(agent.status || "pending").trim().slice(0, 80),
      activity: String(agent.activity || "").trim().slice(0, 1e3),
      activeMs: Math.max(0, Number(agent.activeMs) || 0),
      model: String(agent.model || "").trim().slice(0, 120),
      summary: String(agent.summary || "").trim().slice(0, 8e3)
    };
  }).filter(Boolean) : [];
  const strategySuggestions = Array.isArray(source.strategySuggestions) ? source.strategySuggestions.slice(-50).map((suggestion, index) => {
    if (!isObject(suggestion)) return null;
    const id = String(suggestion.id || `strategy-${index + 1}`).trim().slice(0, 120);
    const text = String(suggestion.text || "").trim().slice(0, 4e3);
    if (!id || !text) return null;
    return {
      id,
      text,
      status: ["queued", "applied"].includes(suggestion.status) ? suggestion.status : "queued",
      submittedAt: String(suggestion.submittedAt || ""),
      appliedAt: suggestion.appliedAt ? String(suggestion.appliedAt) : null,
      waveIndex: Number.isInteger(suggestion.waveIndex) ? suggestion.waveIndex : null
    };
  }).filter(Boolean) : [];
  const events = Array.isArray(source.events) ? source.events.slice(-200).map((event, index) => {
    if (!isObject(event)) return null;
    const message = String(event.message || "").trim().slice(0, 2e3);
    if (!message) return null;
    return {
      id: String(event.id || `event-${index + 1}`).trim().slice(0, 120),
      type: String(event.type || "info").trim().slice(0, 80),
      message,
      at: String(event.at || "")
    };
  }).filter(Boolean) : [];
  return {
    status: [
      "idle",
      "starting",
      "running",
      "completed",
      "failed",
      "cancelled"
    ].includes(source.status) ? source.status : "idle",
    runId: typeof source.runId === "string" ? source.runId.trim().slice(0, 200) || null : null,
    currentWaveIndex: Math.max(
      0,
      Number.parseInt(source.currentWaveIndex, 10) || 0
    ),
    workItems,
    agents,
    strategySuggestions,
    events,
    startedAt: source.startedAt ? String(source.startedAt) : null,
    completedAt: source.completedAt ? String(source.completedAt) : null,
    finalizedArtifactId: typeof source.finalizedArtifactId === "string" ? source.finalizedArtifactId.trim().slice(0, 120) || null : null,
    error: String(source.error || "").trim().slice(0, 2e3)
  };
}
function normalizeQuestion(value) {
  if (value === null) return null;
  if (!isObject(value)) return null;
  const id = String(value.id || "").trim().slice(0, 120);
  const text = String(value.text || "").trim().slice(0, 2e3);
  if (!id || !text) return null;
  const choices = normalizeStringList(value.choices).slice(0, 6);
  const recommended = choices.includes(value.recommended) ? value.recommended : null;
  return {
    id,
    text,
    rationale: String(value.rationale || "").trim().slice(0, 1200),
    choices,
    recommended,
    allowFreeText: value.allowFreeText !== false,
    answerPlaceholder: String(value.answerPlaceholder || "").trim().slice(0, 200)
  };
}
function normalizePrototypeReview(value) {
  const revisions = isObject(value) && Array.isArray(value.revisions) ? value.revisions.slice(-50).map((revision, index) => {
    if (!isObject(revision)) return null;
    const id = String(revision.id || `revision-${index + 1}`).trim().slice(0, 120);
    const suggestion = String(revision.suggestion || "").trim().slice(0, 4e3);
    if (!id || !suggestion) return null;
    const status = [
      "processing",
      "clarifying",
      "applied",
      "failed"
    ].includes(revision.status) ? revision.status : "processing";
    const clarifications = Array.isArray(revision.clarifications) ? revision.clarifications.slice(0, 20).map((clarification) => {
      if (!isObject(clarification)) return null;
      const question = String(
        clarification.question || ""
      ).trim().slice(0, 2e3);
      const answer = String(
        clarification.answer || ""
      ).trim().slice(0, 4e3);
      return question && answer ? { question, answer } : null;
    }).filter(Boolean) : [];
    return {
      id,
      suggestion,
      status,
      summary: String(revision.summary || "").trim().slice(0, 4e3),
      clarifications,
      submittedAt: String(revision.submittedAt || ""),
      completedAt: revision.completedAt ? String(revision.completedAt) : null
    };
  }).filter(Boolean) : [];
  const revisionIds = new Set(revisions.map((revision) => revision.id));
  const activeRevisionId = isObject(value) && revisionIds.has(value.activeRevisionId) ? value.activeRevisionId : null;
  const evidence = isObject(value) && Array.isArray(value.evidence) ? value.evidence.slice(-100).map((entry, index) => {
    if (!isObject(entry)) return null;
    const id = String(entry.id || `evidence-${index + 1}`).trim().slice(0, 120);
    const content = String(entry.content || "").trim().slice(0, 8e3);
    if (!id || !content) return null;
    return {
      id,
      type: String(entry.type || "observation").trim().slice(0, 80),
      content,
      recordedAt: String(entry.recordedAt || "")
    };
  }).filter(Boolean) : [];
  return {
    revisions,
    activeRevisionId,
    question: isObject(value) ? normalizeQuestion(value.question) : null,
    evidence,
    designSpecArtifactId: isObject(value) && typeof value.designSpecArtifactId === "string" ? value.designSpecArtifactId.trim().slice(0, 120) || null : null
  };
}
function normalizeDecisionGraph(value, legacyQuestion = null) {
  const rawNodes = isObject(value) && Array.isArray(value.nodes) ? value.nodes : [];
  const nodes = [];
  const ids = /* @__PURE__ */ new Set();
  for (const rawNode of rawNodes.slice(0, 50)) {
    if (!isObject(rawNode)) continue;
    const id = String(rawNode.id || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
    if (!id || ids.has(id)) continue;
    const normalizedQuestion = normalizeQuestion(rawNode.question);
    const question = normalizedQuestion ? { ...normalizedQuestion, id } : null;
    const title = String(rawNode.title || question?.text || id).trim().slice(0, 240);
    if (!title) continue;
    ids.add(id);
    nodes.push({
      id,
      title,
      dependencies: normalizeStringList(rawNode.dependencies).slice(0, 20),
      question,
      answer: typeof rawNode.answer === "string" && rawNode.answer.trim() ? rawNode.answer.trim().slice(0, 4e3) : null,
      status: "toAnswer"
    });
  }
  if (nodes.length === 0) {
    const question = normalizeQuestion(legacyQuestion);
    if (question) {
      nodes.push({
        id: question.id,
        title: question.text,
        dependencies: [],
        question,
        answer: null,
        status: "active"
      });
    }
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    node.dependencies = [
      ...new Set(
        node.dependencies.filter(
          (dependencyId) => dependencyId !== node.id && nodesById.has(dependencyId)
        )
      )
    ];
  }
  let activeAssigned = false;
  for (const node of nodes) {
    const dependenciesAnswered = node.dependencies.every(
      (dependencyId) => nodesById.get(dependencyId)?.answer
    );
    if (node.answer) {
      node.status = "answered";
    } else if (!activeAssigned && dependenciesAnswered && node.question) {
      node.status = "active";
      activeAssigned = true;
    } else {
      node.status = "toAnswer";
    }
  }
  return { nodes };
}
function revisionQuestionError(question) {
  if (!question) return null;
  const choices = question.choices || [];
  if (choices.length < 3 || choices.length > 5) {
    return "Prototype clarification questions must provide 3 to 5 options.";
  }
  if (new Set(choices.map((choice) => choice.toLowerCase())).size !== choices.length) {
    return "Prototype clarification options must be distinct.";
  }
  return null;
}
function firstActiveQuestion(decisionGraph) {
  return decisionGraph.nodes.find((node) => node.status === "active")?.question || null;
}
function generatedDecisionGraphError(decisionGraph) {
  if (decisionGraph.nodes.length === 0) {
    return "The generated requirements DAG did not contain any decisions.";
  }
  if (decisionGraph.nodes.some((node) => !node.question)) {
    return "Every generated requirements node must include a complete question.";
  }
  const indegrees = new Map(
    decisionGraph.nodes.map((node) => [node.id, node.dependencies.length])
  );
  const dependents = new Map(
    decisionGraph.nodes.map((node) => [node.id, []])
  );
  for (const node of decisionGraph.nodes) {
    for (const dependencyId of node.dependencies) {
      dependents.get(dependencyId)?.push(node.id);
    }
  }
  const ready = [...indegrees].filter(([, indegree]) => indegree === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop();
    visited += 1;
    for (const dependentId of dependents.get(id) || []) {
      const nextIndegree = indegrees.get(dependentId) - 1;
      indegrees.set(dependentId, nextIndegree);
      if (nextIndegree === 0) ready.push(dependentId);
    }
  }
  if (visited !== decisionGraph.nodes.length) {
    return "The generated requirements graph contains a dependency cycle.";
  }
  if (!decisionGraph.nodes.some((node) => node.status === "active")) {
    return "The generated requirements DAG did not expose an active decision.";
  }
  return null;
}
function dependentNodeIds(decisionGraph, changedNodeId) {
  const invalidated = /* @__PURE__ */ new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of decisionGraph.nodes) {
      if (node.id !== changedNodeId && !invalidated.has(node.id) && node.dependencies.some(
        (dependencyId) => dependencyId === changedNodeId || invalidated.has(dependencyId)
      )) {
        invalidated.add(node.id);
        changed = true;
      }
    }
  }
  return invalidated;
}
function invalidateDependentNodes(decisionGraph, changedNodeId) {
  const nodes = decisionGraph.nodes.map((node) => ({
    ...node,
    dependencies: [...node.dependencies],
    question: node.question ? { ...node.question } : null
  }));
  const invalidated = dependentNodeIds(decisionGraph, changedNodeId);
  for (const node of nodes) {
    if (invalidated.has(node.id)) {
      node.answer = null;
      node.status = "toAnswer";
    }
  }
  return normalizeDecisionGraph({ nodes });
}
function normalizeLifecycle(value) {
  const completedInput = new Set(
    isObject(value) ? normalizeStringList(value.completedStages) : []
  );
  const completedStages = [];
  for (const stage of LIFECYCLE_STAGES) {
    if (!completedInput.has(stage.id)) break;
    completedStages.push(stage.id);
  }
  const outputs = isObject(value) && Array.isArray(value.outputs) ? value.outputs.filter(
    (output) => isObject(output) && LIFECYCLE_STAGES.some((stage) => stage.id === output.stageId)
  ).map((output) => {
    const path = String(output.path || "").slice(0, 500);
    const legacyPrefix = [".intent", "studio"].join("");
    return {
      stageId: String(output.stageId),
      path: path.startsWith(legacyPrefix) ? `.tandem${path.slice(legacyPrefix.length)}` : path,
      completedAt: String(output.completedAt || "")
    };
  }) : [];
  const currentStage = LIFECYCLE_STAGES[Math.min(completedStages.length, LIFECYCLE_STAGES.length - 1)].id;
  return { currentStage, completedStages, outputs };
}
function normalizeReloadReceipt(value) {
  if (!isObject(value)) return null;
  if (!["reloading", "success", "error"].includes(value.status)) return null;
  return {
    status: value.status,
    message: String(value.message || "").trim().slice(0, 500),
    requestedAt: String(value.requestedAt || ""),
    completedAt: value.completedAt ? String(value.completedAt) : null,
    extensionId: USER_EXTENSION_ID
  };
}
function normalizeProcessing(value) {
  if (!isObject(value)) return null;
  if (!["running", "success", "error"].includes(value.status)) return null;
  const requestId = String(value.requestId || "").trim().slice(0, 120);
  if (!requestId) return null;
  return {
    status: value.status,
    action: ANSWER_ACTIONS.has(value.action) ? value.action : "answer-decision",
    message: String(value.message || "").trim().slice(0, 500),
    requestId,
    factoryName: value.factoryName ? String(value.factoryName).trim().slice(0, 200) : null,
    answer: typeof value.answer === "string" ? value.answer.trim().slice(0, 4e3) : null,
    runId: value.runId ? String(value.runId).trim().slice(0, 200) : null,
    requestedAt: String(value.requestedAt || ""),
    completedAt: value.completedAt ? String(value.completedAt) : null,
    question: normalizeQuestion(value.question),
    originalDecisionGraph: value.action === "change-answer" ? normalizeDecisionGraph(value.originalDecisionGraph) : null
  };
}
function normalizeSuggestionProcessing(value) {
  if (!isObject(value)) return null;
  if (!["running", "success", "error"].includes(value.status)) return null;
  const requestId = String(value.requestId || "").trim().slice(0, 120);
  if (!requestId) return null;
  return {
    status: value.status,
    message: String(value.message || "").trim().slice(0, 500),
    requestId,
    factoryName: String(
      value.factoryName || SUGGESTION_FACTORY_NAME
    ).trim().slice(0, 200),
    runId: value.runId ? String(value.runId).trim().slice(0, 200) : null,
    usageItems: normalizeStringList(value.usageItems).map((item) => item.slice(0, 500)).slice(0, 30),
    requestedAt: String(value.requestedAt || ""),
    completedAt: value.completedAt ? String(value.completedAt) : null
  };
}
function normalizeStoredState(value, prototypeId) {
  if (!isObject(value) || value.version !== 1) {
    return createState(prototypeId);
  }
  const phase = ["discovery", "building", "iterating", "complete"].includes(value.phase) ? value.phase : "discovery";
  const previewStatus = ["waiting", "starting", "ready", "error"].includes(value.previewStatus) ? value.previewStatus : "waiting";
  const lifecycle = normalizeLifecycle(value.lifecycle);
  const isUsageSubstage = isObject(value.requirements) && value.requirements.substage === "usage";
  const decisionGraph = normalizeDecisionGraph(
    value.decisionGraph,
    isUsageSubstage ? null : value.question
  );
  const requirements = normalizeRequirements(value.requirements, decisionGraph);
  const planning = normalizePlanning(value.planning);
  const designReview = normalizeDesignReview(value.designReview);
  const testDesignReview = normalizeDesignReview(value.testDesignReview);
  return {
    ...createState(prototypeId),
    stage: lifecycle.currentStage,
    lifecycle,
    goal: String(value.goal || "").slice(0, 4e3),
    phase,
    status: String(value.status || "").slice(0, 1e3),
    requirements,
    question: requirements.substage === "usage" ? usageQuestion(requirements.suggestions) : firstActiveQuestion(decisionGraph),
    decisionGraph,
    confirmed: normalizeStringList(value.confirmed),
    assumed: normalizeStringList(value.assumed),
    deferred: normalizeStringList(value.deferred),
    artifacts: normalizeArtifacts(value.artifacts),
    previewUrl: normalizePreviewUrl(value.previewUrl, true),
    previewStatus,
    prototypeReview: normalizePrototypeReview(value.prototypeReview),
    design: normalizeDesign(value.design, designReview),
    designReview,
    testDesignReview,
    planning,
    implementation: normalizeImplementation(value.implementation, planning),
    testing: normalizeTesting(value.testing, testDesignReview),
    processing: normalizeProcessing(value.processing),
    suggestionProcessing: normalizeSuggestionProcessing(
      value.suggestionProcessing
    ),
    reloadReceipt: normalizeReloadReceipt(value.reloadReceipt),
    updatedAt: String(value.updatedAt || (/* @__PURE__ */ new Date()).toISOString())
  };
}
function normalizePreviewUrl(value, allowInvalidAsNull = false) {
  if (value === null || value === void 0 || value === "") return null;
  try {
    const parsed = new URL(String(value));
    const allowedHost = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
    if (!["http:", "https:"].includes(parsed.protocol) || !allowedHost) {
      throw new Error("Preview URL must use HTTP on a loopback host.");
    }
    return parsed.href;
  } catch (error) {
    if (allowInvalidAsNull) return null;
    throw new CanvasError(
      "invalid_preview_url",
      error instanceof Error ? error.message : "Invalid preview URL."
    );
  }
}
function readHtmlAttribute(tag, attribute) {
  const match = tag.match(
    new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match ? match[1] ?? match[2] ?? "" : null;
}
async function verifyPreviewIdentity(url, prototypeId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5e3);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: "error"
    });
  } catch (error) {
    throw new CanvasError(
      "preview_unreachable",
      `The prototype URL is not reachable: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new CanvasError(
      "preview_unreachable",
      `The prototype URL returned HTTP ${response.status}.`
    );
  }
  const html = (await response.text()).slice(0, 256 * 1024);
  const markerTag = (html.match(/<meta\b[^>]*>/gi) || []).find(
    (tag) => PREVIEW_IDENTITY_MARKERS.has(readHtmlAttribute(tag, "name"))
  );
  const markerValue = markerTag ? readHtmlAttribute(markerTag, "content") : null;
  const actualId = markerValue ? normalizePrototypeId(markerValue) : null;
  if (!actualId) {
    throw new CanvasError(
      "preview_identity_missing",
      `The page at ${url} does not declare <meta name="tandem-prototype-id" content="${prototypeId}">.`
    );
  }
  if (actualId !== prototypeId) {
    throw new CanvasError(
      "preview_identity_mismatch",
      `The page at ${url} belongs to prototype "${actualId}", not "${prototypeId}".`
    );
  }
}
async function loadState(prototypeId) {
  const id = normalizePrototypeId(prototypeId);
  const path = stateFilePath(id);
  try {
    const stored = JSON.parse(await readFile(path, "utf8"));
    const state2 = normalizeStoredState(stored, id);
    stateCache.set(id, state2);
    return state2;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      await logSafely(
        "Could not restore Tandem state.",
        "warning"
      );
      if (stateCache.has(id)) return stateCache.get(id);
    }
  }
  for (const legacyPath of legacyStateFilePaths(id)) {
    try {
      const stored = JSON.parse(await readFile(legacyPath, "utf8"));
      const state2 = normalizeStoredState(stored, id);
      await persistState(state2);
      return state2;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        await logSafely(
          "Could not migrate legacy Tandem state.",
          "warning"
        );
      }
    }
  }
  const state = createState(id);
  stateCache.set(id, state);
  return state;
}
async function persistState(state) {
  stateCache.set(state.prototypeId, state);
  const path = stateFilePath(state.prototypeId);
  if (!path) return;
  const previous = writeQueues.get(state.prototypeId) || Promise.resolve();
  const next = previous.catch(() => void 0).then(async () => {
    await mkdir(STATE_DIRECTORY, { recursive: true });
    await writeJsonAtomically(path, state);
  });
  writeQueues.set(state.prototypeId, next);
  await next;
}
async function withAnswerClaim(prototypeId, operation, rejectIfBusy = false) {
  let release;
  while (!release) {
    const existing = answerClaims.get(prototypeId);
    if (existing) {
      if (rejectIfBusy) {
        throw new AnswerRequestError(
          409,
          "Another answer is being accepted. Try again."
        );
      }
      await existing;
      continue;
    }
    let resolveClaim;
    const claim = new Promise((resolve2) => {
      resolveClaim = resolve2;
    });
    answerClaims.set(prototypeId, claim);
    release = () => {
      if (answerClaims.get(prototypeId) === claim) {
        answerClaims.delete(prototypeId);
      }
      resolveClaim();
    };
  }
  try {
    return await operation();
  } finally {
    release();
  }
}
async function isPreferredAnswerProvider(extensionId) {
  const extensionList = await session.rpc.extensions.list();
  const runningIds = new Set(
    extensionList.extensions.filter((extension) => extension.status === "running").map((extension) => extension.id)
  );
  if (runningIds.has(USER_EXTENSION_ID)) {
    return extensionId === USER_EXTENSION_ID;
  }
  return runningIds.has(PROJECT_EXTENSION_ID) && extensionId === PROJECT_EXTENSION_ID;
}
async function refreshEntryAnswerCapability(entry) {
  const wasEnabled = entry.canSubmitAnswers;
  entry.canSubmitAnswers = await isPreferredAnswerProvider(entry.extensionId);
  if (entry.canSubmitAnswers) {
    let state = await loadState(entry.prototypeId);
    if (!wasEnabled) {
      recoverAnswerFactory(state, true);
      recoverSuggestionFactory(state, true);
      state = await ensureUsageSuggestionsStarted(state, true);
    }
    recoverPrototypeCompletion(state, true);
  }
}
function publicState(entry, state) {
  const source = String(entry.extensionId || "").split(":", 1)[0] || "unknown";
  return {
    ...state,
    provider: {
      extensionId: entry.extensionId,
      source,
      canReload: entry.extensionId === USER_EXTENSION_ID,
      canSubmitAnswers: entry.canSubmitAnswers
    }
  };
}
function publishState(prototypeId) {
  const state = stateCache.get(prototypeId);
  if (!state) return;
  for (const entry of servers.values()) {
    if (entry.prototypeId !== prototypeId) continue;
    const event = `data: ${JSON.stringify(publicState(entry, state))}

`;
    for (const client of entry.clients) {
      client.write(event);
    }
  }
}
async function resolvePrototypeId(instanceId, requestedId) {
  const explicitId = requestedId || instancePrototypeIds.get(instanceId);
  if (explicitId) return normalizePrototypeId(explicitId);
  return await loadCurrentPrototypeId() || DEFAULT_PROTOTYPE_ID;
}
async function updateTandem(ctx) {
  const input = isObject(ctx.input) ? ctx.input : {};
  const prototypeId = await resolvePrototypeId(ctx.instanceId, input.prototypeId);
  if (!await isPreferredAnswerProvider(ctx.extensionId)) {
    throw new CanvasError(
      "read_only_provider",
      "Update Tandem through the installed user-scoped provider."
    );
  }
  return withAnswerClaim(prototypeId, async () => {
    const stored = await loadState(prototypeId);
    if (stored.processing?.status === "running") {
      throw new CanvasError(
        "processing_in_progress",
        "Wait for the hidden Tandem agent to finish."
      );
    }
    const current = input.reset ? createState(prototypeId) : stored;
    const next = { ...current };
    if (typeof input.goal === "string") {
      next.goal = input.goal.trim().slice(0, 4e3);
    }
    if (typeof input.stage === "string" && input.stage.trim()) {
      next.stage = input.stage.trim().slice(0, 80);
    }
    if (["discovery", "building", "iterating", "complete"].includes(input.phase)) {
      next.phase = input.phase;
    }
    if (typeof input.status === "string") {
      next.status = input.status.trim().slice(0, 1e3);
    }
    if (Object.prototype.hasOwnProperty.call(input, "question")) {
      next.question = normalizeQuestion(input.question);
    }
    if (Object.prototype.hasOwnProperty.call(input, "requirements")) {
      next.requirements = normalizeRequirements(
        input.requirements,
        next.decisionGraph
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "decisionGraph")) {
      next.decisionGraph = normalizeDecisionGraph(
        input.decisionGraph,
        null
      );
      const requirementsInput = Object.prototype.hasOwnProperty.call(
        input,
        "requirements"
      ) ? next.requirements : {
        ...next.requirements,
        substage: next.decisionGraph.nodes.length > 0 ? "dag" : next.requirements.substage
      };
      next.requirements = normalizeRequirements(
        requirementsInput,
        next.decisionGraph
      );
      next.question = next.requirements.substage === "usage" ? usageQuestion(next.requirements.suggestions) : firstActiveQuestion(next.decisionGraph);
    }
    if (Array.isArray(input.confirmed)) {
      next.confirmed = normalizeStringList(input.confirmed);
    }
    if (Array.isArray(input.assumed)) {
      next.assumed = normalizeStringList(input.assumed);
    }
    if (Array.isArray(input.deferred)) {
      next.deferred = normalizeStringList(input.deferred);
    }
    if (Array.isArray(input.artifacts)) {
      next.artifacts = normalizeArtifacts(
        input.artifacts,
        next.lifecycle.currentStage
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "prototypeReview")) {
      next.prototypeReview = normalizePrototypeReview(input.prototypeReview);
    }
    if (Object.prototype.hasOwnProperty.call(input, "designReview")) {
      next.designReview = normalizeDesignReview(input.designReview);
    }
    if (Object.prototype.hasOwnProperty.call(input, "planning")) {
      next.planning = normalizePlanning(input.planning);
    }
    if (Object.prototype.hasOwnProperty.call(input, "previewUrl")) {
      const previewUrl = normalizePreviewUrl(input.previewUrl);
      if (previewUrl) {
        await verifyPreviewIdentity(previewUrl, prototypeId);
      }
      next.previewUrl = previewUrl;
    }
    if (["waiting", "starting", "ready", "error"].includes(input.previewStatus)) {
      next.previewStatus = input.previewStatus;
    }
    next.lifecycle = normalizeLifecycle(next.lifecycle);
    next.stage = next.lifecycle.currentStage;
    next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await persistState(next);
    instancePrototypeIds.set(ctx.instanceId, prototypeId);
    await persistCurrentPrototypeId(prototypeId);
    publishState(prototypeId);
    return next;
  });
}
function stageCompletionError(state, stageId, { requirePrototypeSpec = true } = {}) {
  if (stageId === "requirements") {
    if (state.requirements.substage !== "dag") {
      return "Generate the requirements DAG from at least one usage first.";
    }
    if (state.decisionGraph.nodes.length === 0) {
      return "Generate at least one requirement decision before finishing.";
    }
    const remaining = state.decisionGraph.nodes.filter((node) => !node.answer);
    if (remaining.length > 0) {
      return `${remaining.length} requirement decision${remaining.length === 1 ? "" : "s"} remain unanswered.`;
    }
    if (state.artifacts.length >= 30 && !state.artifacts.some(
      (artifact) => artifact.id === "requirements-result"
    )) {
      return "Remove one artifact before finishing so the Requirements result can be captured.";
    }
  }
  if (stageId === "prototype" && state.previewStatus !== "ready") {
    return "The runnable prototype must be ready before this stage can finish.";
  }
  if (stageId === "prototype" && state.prototypeReview.question) {
    return "Answer the open prototype clarification before finishing.";
  }
  if (stageId === "prototype" && requirePrototypeSpec && !["draft-feature-spec", "design-spec"].includes(
    state.prototypeReview.designSpecArtifactId
  )) {
    return "Finish Prototype in Tandem to generate its draft feature specification.";
  }
  if (stageId === "design" && (state.designReview.processing || state.designReview.finalizeRequested || state.designReview.threads.some(
    (thread) => ["queued", "processing", "answered", "failed"].includes(
      thread.status
    )
  ) || state.testDesignReview.processing || state.testDesignReview.finalizeRequested || state.testDesignReview.threads.some(
    (thread) => ["queued", "processing", "answered", "failed"].includes(
      thread.status
    )
  ))) {
    return "Resolve every product and test design thread before completing Design.";
  }
  if (stageId === "design" && (!["design-spec", "design-review"].includes(
    state.designReview.finalizedArtifactId
  ) || state.testDesignReview.finalizedArtifactId !== "test-spec" || !state.artifacts.some(
    (artifact) => artifact.stage === "design" && ["design-spec", "design-review"].includes(artifact.id) && artifact.reviewStatus !== "stale"
  ) || !state.artifacts.some(
    (artifact) => artifact.stage === "design" && artifact.id === "test-spec" && artifact.kind === "test-spec" && artifact.reviewStatus !== "stale"
  ))) {
    return "Finish both Product design and Test design to capture design-spec and test-spec.";
  }
  if (stageId === "plan" && (state.planning.processing || state.planning.status !== "complete" || state.planning.finalizedArtifactId !== "execution-plan" || !state.artifacts.some(
    (artifact) => artifact.stage === "plan" && artifact.id === "execution-plan" && artifact.kind === "execution-plan" && artifact.reviewStatus !== "stale"
  ))) {
    return "Generate and finalize the execution plan before finishing Plan.";
  }
  if (stageId === "implement" && (state.implementation.status !== "completed" || state.implementation.workItems.some(
    (item) => item.status !== "completed"
  ) || state.implementation.finalizedArtifactId !== "final-code" || !state.artifacts.some(
    (artifact) => artifact.stage === "implement" && artifact.id === "final-code" && artifact.kind === "final-code" && artifact.path && artifact.reviewStatus !== "stale"
  ))) {
    return "Run every planned work item successfully before finishing Implement.";
  }
  if (stageId === "test" && (state.testing.status !== "completed" || state.testing.scenarios.some(
    (scenario) => scenario.status !== "passed"
  ) || state.testing.finalizedArtifactId !== "test-results" || !state.artifacts.some(
    (artifact) => artifact.stage === "test" && artifact.id === "test-results" && artifact.kind === "test-results" && artifact.reviewStatus !== "stale"
  ))) {
    return "Run every integration and interaction test successfully before finishing Test.";
  }
  return null;
}
function requirementsResultArtifact(state) {
  const section = (heading, items) => [
    `## ${heading}`,
    "",
    ...items.length > 0 ? items.map((item) => `- ${item}`) : ["- None"],
    ""
  ];
  return {
    id: "requirements-result",
    title: "Requirements",
    kind: "requirements",
    stage: "requirements",
    path: "",
    language: "markdown",
    content: [
      "# Requirements",
      "",
      ...section("Usage", state.requirements.usageItems),
      ...section("Confirmed", state.confirmed),
      ...section("Assumed", state.assumed),
      ...section("Deferred", state.deferred)
    ].join("\n").trim(),
    mermaid: ""
  };
}
async function completeLifecycleStage(prototypeId, requestedStageId, extensionId) {
  if (!await isPreferredAnswerProvider(extensionId)) {
    throw new CanvasError(
      "read_only_provider",
      "Complete stages through the installed user-scoped provider."
    );
  }
  const completed = await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    if (state.processing?.status === "running") {
      throw new CanvasError(
        "processing_in_progress",
        "Wait for the hidden Tandem agent to finish."
      );
    }
    const lifecycle = normalizeLifecycle(state.lifecycle);
    const stageId = requestedStageId || lifecycle.currentStage;
    if (stageId !== lifecycle.currentStage) {
      throw new CanvasError(
        "stage_not_active",
        `Only the active ${lifecycle.currentStage} stage can be completed.`
      );
    }
    if (lifecycle.completedStages.includes(stageId)) {
      return state;
    }
    const blocker = stageCompletionError(state, stageId);
    if (blocker) {
      throw new CanvasError("stage_not_ready", blocker);
    }
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const artifacts = stageId === "requirements" ? normalizeArtifacts([
      requirementsResultArtifact(state),
      ...state.artifacts.filter(
        (artifact) => artifact.id !== "requirements-result"
      )
    ]) : state.artifacts;
    const relativeOutputPath = join(
      ".tandem",
      prototypeId,
      "stages",
      `${stageId}.json`
    );
    const outputPath = join(
      STATE_DIRECTORY,
      prototypeId,
      "stages",
      `${stageId}.json`
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeJsonAtomically(outputPath, {
      version: 1,
      prototypeId,
      stageId,
      completedAt,
      result: {
        goal: state.goal,
        requirements: state.requirements,
        confirmed: state.confirmed,
        assumed: state.assumed,
        deferred: state.deferred,
        decisionGraph: state.decisionGraph,
        artifacts,
        previewUrl: state.previewUrl,
        previewStatus: state.previewStatus,
        prototypeReview: state.prototypeReview,
        designReview: state.designReview,
        design: state.design,
        testDesignReview: state.testDesignReview,
        planning: state.planning,
        implementation: state.implementation,
        testing: state.testing
      }
    });
    const completedStages = [...lifecycle.completedStages, stageId];
    const currentStage = LIFECYCLE_STAGES[Math.min(completedStages.length, LIFECYCLE_STAGES.length - 1)].id;
    let next = {
      ...state,
      artifacts,
      stage: currentStage,
      lifecycle: {
        currentStage,
        completedStages,
        outputs: [
          ...lifecycle.outputs.filter(
            (output) => output.stageId !== stageId
          ),
          { stageId, path: relativeOutputPath, completedAt }
        ]
      },
      phase: completedStages.length === LIFECYCLE_STAGES.length ? "complete" : currentStage === "requirements" ? "discovery" : "building",
      status: completedStages.length === LIFECYCLE_STAGES.length ? "All lifecycle stages are complete." : `${LIFECYCLE_STAGES.find((stage) => stage.id === stageId).label} completed. ${LIFECYCLE_STAGES.find((stage) => stage.id === currentStage).label} is now enabled.`,
      updatedAt: completedAt
    };
    next = seedDefaultProductDesignReview(next, completedAt);
    await persistState(next);
    publishState(prototypeId);
    return next;
  });
  if (completed.lifecycle.currentStage === "design" && completed.designReview.threads.some((thread) => thread.status === "queued")) {
    startDesignReviewQueue(prototypeId);
  }
  return completed;
}
async function completeStage(ctx) {
  const input = isObject(ctx.input) ? ctx.input : {};
  const prototypeId = await resolvePrototypeId(ctx.instanceId, input.prototypeId);
  return completeLifecycleStage(
    prototypeId,
    typeof input.stageId === "string" ? input.stageId : "",
    ctx.extensionId
  );
}
function recoverPrototypeCompletion(state, canSubmitAnswers) {
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "prototype" || state.processing?.status !== "success" || state.processing.action !== "generate-design-spec" || !["draft-feature-spec", "design-spec"].includes(
    state.prototypeReview.designSpecArtifactId
  ) || activePrototypeCompletions.has(state.prototypeId)) {
    return;
  }
  activePrototypeCompletions.add(state.prototypeId);
  completeLifecycleStage(
    state.prototypeId,
    "prototype",
    PROVIDER_EXTENSION_ID
  ).catch(
    (error) => logSafely(
      `Tandem could not resume Prototype completion: ${error instanceof Error ? error.message : String(error)}`
    )
  ).finally(() => activePrototypeCompletions.delete(state.prototypeId));
}
async function readRequestBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
      throw new Error("Request is too large.");
    }
  }
  return JSON.parse(body || "{}");
}
function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value));
}
function factoryStateSnapshot(state) {
  let remainingArtifactCharacters = 12e4;
  const artifacts = state.artifacts.map((artifact) => {
    const content = artifact.content.slice(
      0,
      Math.max(0, Math.min(2e4, remainingArtifactCharacters))
    );
    remainingArtifactCharacters -= content.length;
    const mermaid = artifact.mermaid.slice(
      0,
      Math.max(0, Math.min(12e3, remainingArtifactCharacters))
    );
    remainingArtifactCharacters -= mermaid.length;
    return {
      ...artifact,
      content,
      mermaid,
      contentTruncated: content.length < artifact.content.length,
      mermaidTruncated: mermaid.length < artifact.mermaid.length
    };
  });
  return {
    version: state.version,
    prototypeId: state.prototypeId,
    stage: state.stage,
    goal: state.goal,
    phase: state.phase,
    status: state.status,
    lifecycle: state.lifecycle,
    requirements: state.requirements,
    question: state.question,
    decisionGraph: state.decisionGraph,
    confirmed: state.confirmed,
    assumed: state.assumed,
    deferred: state.deferred,
    artifacts,
    previewUrl: state.previewUrl,
    previewStatus: state.previewStatus,
    prototypeReview: state.prototypeReview,
    designReview: state.designReview,
    design: state.design,
    testDesignReview: state.testDesignReview,
    planning: state.planning,
    implementation: state.implementation,
    testing: state.testing
  };
}
function answerFactoryPrompt(args) {
  const actionInstructions = {
    "add-usage": [
      "The submitted answer is one new usage sentence. Append it exactly once to",
      "requirements.usageItems, keep requirements.substage as usage, and return an",
      "empty decision graph. Generate 3 to 5 concise, non-overlapping usage",
      "suggestions that complement everything already listed. Each suggestion must",
      "be one clickable sentence describing how the user could use the app."
    ],
    "generate-dag": [
      "Switch requirements.substage to dag and generate the complete requirements",
      "decision DAG from requirements.usageItems. Cover every listed usage while",
      "sharing common prerequisites. Give every node its complete question and",
      "choices now, including toAnswer nodes, so dependents can be regenerated.",
      "Return no usage suggestions."
    ],
    "answer-decision": [
      "Apply the submitted answer to the active DAG node. Recompute every transitive",
      "dependent node whose content is affected by the answer; do not carry forward",
      "static downstream wording that assumed a different answer. Promote the next",
      "eligible toAnswer node to active."
    ],
    "change-answer": [
      "The user changed an answered DAG node. Apply the new answer to that",
      "node and regenerate every transitive dependent node from the changed frontier.",
      "All descendant answers have already been cleared in the supplied state. Keep",
      "them unanswered and rewrite their titles, questions, choices, and dependencies",
      "to match the changed answer. Never preserve stale downstream decisions."
    ],
    "submit-revision": [
      "The answer is a prototype revision suggestion. First decide whether a",
      "material product or interaction detail is unclear. If clarification is",
      "required, do not edit files: set prototypeReview.question to one focused",
      "question with 3 to 5 options and mark the active revision clarifying.",
      "Otherwise implement the revision in the existing prototype, validate the",
      "running preview, mark the active revision applied, summarize the change,",
      "clear the question, and append concrete interaction evidence."
    ],
    "clarify-revision": [
      "The answer resolves prototypeReview.question for the active revision.",
      "Append the question and answer to that revision's clarifications. Apply the",
      "revision to the existing prototype and validate it. Ask one more focused",
      "question only if a material ambiguity remains; otherwise mark the revision",
      "applied, clear the question, summarize the result, and append evidence."
    ],
    "generate-design-spec": [
      "The user has finished prototype iteration. Do not edit prototype files and",
      "do not ask another question. Collect evidence from requirements, the answered",
      "DAG, prototypeReview revisions and clarifications, preview verification, and",
      "existing artifacts. Upsert one complete artifact with id draft-feature-spec,",
      "title Draft feature specification, kind feature-spec, stage prototype,",
      "language markdown, and no path or",
      "Mermaid source. Its content must cover goals, users, workflows, screens,",
      "interaction states, UI contracts, accepted revisions, accessibility,",
      "evidence, unresolved constraints, and a clear handoff for Design and Plan.",
      "Set prototypeReview.designSpecArtifactId to draft-feature-spec and clear its",
      "question."
    ]
  };
  return [
    "You are the hidden execution worker for one Tandem decision.",
    "Process the answer without sending a message to the parent chat, opening a",
    "canvas, or editing .tandem files. The extension owns Tandem persistence.",
    "",
    `Target project root: ${args.projectRoot}`,
    `Prototype ID: ${args.prototypeId}`,
    `Question ID: ${args.question.id}`,
    `Question: ${args.question.text}`,
    `Answer: ${args.answer}`,
    `Action: ${args.action}`,
    "",
    "Current Tandem state:",
    JSON.stringify(args.state, null, 2),
    "",
    ...actionInstructions[args.action],
    "",
    "Treat the answer as an authoritative product decision. Update project files",
    "only when the decision requires a prototype change, following the existing",
    "stack and keeping production integrations, tests, and polish out of scope.",
    "Perform a targeted validation after code changes.",
    "Do not advance or complete lifecycle stages. Stage completion is explicit and",
    "owned by Tandem after the active stage meets its completion criteria.",
    "While lifecycle.currentStage is requirements, do not edit prototype files or",
    "publish a preview. Preserve and return the complete requirements object. During",
    "usage intake, the extension creates the intake question from suggestions. Once",
    "the DAG is fully answered, leave question null and report that requirements are",
    "ready to be completed.",
    "",
    "Return the complete prototypeReview, ledger, and lifecycle state matching the",
    "output schema. Return only changed or new artifacts in artifactChanges.upsert",
    "and IDs intentionally removed in artifactChanges.remove; leave both arrays",
    "empty when artifacts are unchanged. Each upsert must contain the complete",
    "replacement artifact even when the input snapshot was marked as truncated.",
    "Artifacts must be concise synthesized intents, models, contracts, or Mermaid",
    "workflows rather than pasted source. Ask exactly one next high-impact question,",
    "or return null when implementation/iteration can proceed without another",
    "decision. Preserve the current preview URL and status unless you have verified",
    "a replacement.",
    "Every artifact upsert must set stage to requirements, prototype, design, plan,",
    "or implement according to the lifecycle stage that owns the result.",
    "Preserve all prior prototypeReview revisions, clarifications, and evidence.",
    "Every question must offer 3 to 5 carefully selected, mutually distinct choices",
    "that span the important decision space without a generic catch-all. Put the",
    "recommended default first and set recommended to that exact choice so the user",
    "can submit it without entering text. Keep free text available for overrides.",
    "Return a complete decisionGraph whose nodes are the source of truth for question",
    "selection. Each node id is also its question id. dependencies contains parent",
    "node ids that must be answered first. Include the submitted answer on its node.",
    "A node with every dependency answered must include its question and curated",
    "choices so it can be promoted. Keep independent decisions as separate nodes.",
    "Exactly one unanswered eligible node is active at a time; all other unanswered",
    "nodes are toAnswer. Set question to the active node only; after it is answered,",
    "promote the next eligible toAnswer node to active.",
    "",
    "Always maintain a single artifact with id design-tree, title Design tree,",
    "kind design-tree, stage requirements, and language mermaid. Model decisions as",
    "a prerequisite DAG using flowchart LR: preserve answered branches, shared",
    "prerequisites, the active decision, and known downstream decisions. Style nodes",
    "with Mermaid classes answered, active, and toAnswer. Use solid green styling",
    "for answered, solid blue styling for active, and amber styling for toAnswer.",
    "Exactly one node may be active. Its content must briefly explain the user's",
    "current location. Update this artifact after every answer, including when the",
    "design is confirmed and implementation becomes current."
  ].join("\n");
}
function designReviewFactoryPrompt(args) {
  const thread = args.thread;
  const isTestDesign = args.reviewKind === "test";
  const task = args.action === "finalize" ? [
    isTestDesign ? "Synthesize the integration and interaction test specification from the resolved discussion and current design." : "Synthesize the product design specification from the resolved discussion and current Design artifacts.",
    "Return exactly one artifact with id",
    isTestDesign ? "test-spec, title Test specification, kind test-spec, stage design," : "design-spec, title Design specification, kind design-spec, stage design,",
    "language markdown, empty path and Mermaid, reviewStatus current, and",
    "sourceThreadIds containing every resolved thread ID. Cover accepted",
    isTestDesign ? "integration boundaries, interaction journeys, fixtures, setup, test data, observable outcomes, failure evidence, and coverage risks." : "decisions, architecture, contracts, interaction behavior, risks, tradeoffs, validation expectations, and remaining constraints.",
    isTestDesign ? "Also return structured testScenarios. Include both integration and interaction scenarios where applicable, stable IDs, true dependencies, executable steps, expected outcomes, and concrete validation guidance." : "Return an empty testScenarios array."
  ] : [
    `Request type: ${thread.type}`,
    `Requested artifact kind: ${thread.artifactKind || "none"}`,
    `Artifact under review: ${thread.reviewArtifactId || "none"}`,
    `User request: ${thread.prompt}`,
    "",
    "Inspect the existing project when useful. Answer the request directly using",
    "the draft feature specification, resolved discussion, repository structure,",
    "and existing artifacts as evidence. If the request",
    isTestDesign ? "asks for a test-design artifact, return one or more useful artifacts. An" : "asks for a design artifact, return one or more useful artifacts. An",
    "artifact request must return at least one artifact of the requested",
    "kind. A normal question may also return an artifact when it materially",
    "improves the explanation."
  ];
  return [
    `You are the hidden ${isTestDesign ? "Test Design" : "Product Design"} Review worker for Tandem.`,
    "Do not message the parent chat, open canvases, edit project files, or advance",
    "the lifecycle. Return only the structured output required by the schema.",
    "",
    `Prototype ID: ${args.prototypeId}`,
    `Project root: ${args.projectRoot}`,
    `Action: ${args.action}`,
    `Design substage: ${args.reviewKind}`,
    "",
    "Current Tandem state:",
    JSON.stringify(args.state, null, 2),
    "",
    ...task,
    "",
    "Every returned artifact must use stage design, reviewStatus current, and a",
    "complete stable ID. For a thread request, sourceThreadIds must contain that",
    "thread ID. Use Mermaid for requested diagrams and put valid diagram source in",
    "mermaid. Use concise Markdown content to explain every artifact. Contracts",
    "should capture typed boundaries without inventing production infrastructure.",
    "Decision records should state context, decision, alternatives, and consequences.",
    "For non-finalization requests, return an empty testScenarios array.",
    "The answer should explain the result and name any generated artifacts."
  ].join("\n");
}
function planningFactoryPrompt(args) {
  return [
    "You are the hidden execution-planning worker for Tandem.",
    "Do not implement code, edit files, message the parent chat, open canvases, or",
    "advance the lifecycle. Return only the structured output required by the schema.",
    "",
    `Prototype ID: ${args.prototypeId}`,
    `Maximum parallel agents: ${args.maxAgents}`,
    `Action: ${args.action}`,
    `Revision instruction: ${args.instruction || "Create the initial execution plan."}`,
    "",
    "Current Tandem state:",
    JSON.stringify(args.state, null, 2),
    "",
    "Create an efficient implementation plan grounded in the accepted design-spec,",
    "test-spec, draft feature specification, contracts, architecture, and repository.",
    "Divide the work into the smallest independently implementable units that still",
    "produce coherent, reviewable changes. Minimize dependencies and expose the widest",
    "safe frontier without inventing artificial parallelism.",
    "",
    "For each work item provide a stable kebab-case ID, precise outcome, prerequisite",
    "IDs, one agent role, realistic effort hours, owned workspace-relative files or",
    "directories, required skills, observable acceptance criteria, and existing",
    "validation commands or checks. Reserve execution of integration and interaction",
    "scenarios from test-spec for the post-implementation Test stage; implementation",
    "work may still create required harnesses or testability seams. Work items that can run together should not claim",
    "the same files. Use dependencies only when one item truly consumes another's",
    "output. Include integration and final validation work where necessary.",
    "",
    "The extension computes dependency waves, file-conflict scheduling, agent slots,",
    "critical path, and parallelism savings from your work items. Ensure every",
    "dependency names another returned item, the graph is acyclic, and all required",
    "implementation scope is covered. The strategy must explain orchestration, merge",
    "order, integration points, and how agents coordinate handoffs."
  ].join("\n");
}
function factoryErrorMessage(run) {
  if (run.error) return run.error;
  if (run.failure?.message) return run.failure.message;
  if (run.reason) return run.reason;
  return `Factory run ended with status "${run.status}".`;
}
function factoryErrorCode(error) {
  return error?.code || error?.data?.code || null;
}
async function recordFactoryRunId(prototypeId, requestId, runId, factoryName = ANSWER_FACTORY_NAME) {
  return withAnswerClaim(prototypeId, async () => {
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      return false;
    }
    const current = await loadState(prototypeId);
    if (current.processing?.status !== "running" || current.processing.requestId !== requestId) {
      return false;
    }
    const next = {
      ...current,
      processing: {
        ...current.processing,
        factoryName,
        runId
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
}
async function applyFactoryResult(prototypeId, requestId, run) {
  if (run.status !== "completed" || !isObject(run.result)) {
    throw new Error(factoryErrorMessage(run));
  }
  let completePrototype = false;
  await withAnswerClaim(prototypeId, async () => {
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      return;
    }
    const current = await loadState(prototypeId);
    if (current.processing?.status !== "running" || current.processing.requestId !== requestId) {
      return;
    }
    const result = run.result;
    const previewUrl = normalizePreviewUrl(result.previewUrl);
    if (previewUrl && previewUrl !== current.previewUrl) {
      await verifyPreviewIdentity(previewUrl, prototypeId);
    }
    const phase = ["discovery", "building", "iterating", "complete"].includes(
      result.phase
    ) ? result.phase : current.phase;
    const previewStatus = ["waiting", "starting", "ready", "error"].includes(
      result.previewStatus
    ) ? result.previewStatus : current.previewStatus;
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    let decisionGraph = normalizeDecisionGraph(
      result.decisionGraph,
      result.question
    );
    const action = current.processing.action || "answer-decision";
    if (action === "generate-dag") {
      const graphError = generatedDecisionGraphError(decisionGraph);
      if (graphError) throw new Error(graphError);
    }
    const answeredQuestionId = current.processing.question?.id;
    if (["answer-decision", "change-answer"].includes(action) && answeredQuestionId) {
      const descendants = action === "change-answer" ? dependentNodeIds(current.decisionGraph, answeredQuestionId) : /* @__PURE__ */ new Set();
      decisionGraph = normalizeDecisionGraph({
        nodes: decisionGraph.nodes.map((node) => ({
          ...node,
          answer: node.id === answeredQuestionId ? current.processing.answer : descendants.has(node.id) ? null : node.answer
        }))
      });
    }
    let requirements = normalizeRequirements(
      result.requirements,
      decisionGraph
    );
    if (action === "add-usage" && current.processing.answer) {
      requirements = normalizeRequirements(
        {
          ...requirements,
          substage: "usage",
          usageItems: [
            ...current.requirements.usageItems,
            current.processing.answer
          ]
        },
        { nodes: [] }
      );
      decisionGraph = { nodes: [] };
    } else if (action === "generate-dag") {
      requirements = normalizeRequirements(
        {
          ...requirements,
          substage: "dag",
          usageItems: current.requirements.usageItems,
          suggestions: []
        },
        decisionGraph
      );
    }
    let prototypeReview = normalizePrototypeReview(result.prototypeReview);
    prototypeReview.revisions = [
      ...current.prototypeReview.revisions.filter(
        (revision) => !prototypeReview.revisions.some(
          (candidate) => candidate.id === revision.id
        )
      ),
      ...prototypeReview.revisions
    ].slice(-50);
    prototypeReview.evidence = [
      ...current.prototypeReview.evidence.filter(
        (entry) => !prototypeReview.evidence.some(
          (candidate) => candidate.id === entry.id
        )
      ),
      ...prototypeReview.evidence
    ].slice(-100);
    if (["submit-revision", "clarify-revision"].includes(action)) {
      const questionError = revisionQuestionError(prototypeReview.question);
      if (questionError) throw new Error(questionError);
      const activeRevisionId = current.prototypeReview.activeRevisionId;
      const revision = prototypeReview.revisions.find(
        (candidate) => candidate.id === activeRevisionId
      );
      if (!revision) {
        throw new Error(
          "The hidden agent did not return the active prototype revision."
        );
      }
      if (action === "clarify-revision" && current.processing.question) {
        const clarification = {
          question: current.processing.question.text,
          answer: current.processing.answer
        };
        if (!revision.clarifications.some(
          (entry) => entry.question === clarification.question && entry.answer === clarification.answer
        )) {
          revision.clarifications.push(clarification);
        }
      }
      if (prototypeReview.question) {
        revision.status = "clarifying";
        prototypeReview.activeRevisionId = revision.id;
        revision.completedAt = null;
      } else {
        revision.status = "applied";
        prototypeReview.activeRevisionId = null;
        revision.completedAt = completedAt;
        if (!revision.summary) {
          revision.summary = "Applied the requested prototype revision.";
        }
        if (prototypeReview.evidence.length <= current.prototypeReview.evidence.length && !prototypeReview.evidence.some(
          (entry) => entry.id === `revision-${revision.id}`
        )) {
          prototypeReview.evidence.push({
            id: `revision-${revision.id}`,
            type: "revision",
            content: revision.summary,
            recordedAt: completedAt
          });
        }
      }
    }
    const artifacts = applyArtifactChanges(
      current.artifacts,
      result.artifactChanges
    );
    if (action === "generate-design-spec") {
      const designSpec = artifacts.find(
        (artifact) => artifact.id === "draft-feature-spec" && artifact.kind === "feature-spec" && artifact.stage === "prototype" && artifact.content.trim()
      );
      if (!designSpec) {
        throw new Error(
          "Prototype completion did not produce a valid draft feature specification."
        );
      }
      prototypeReview = {
        ...prototypeReview,
        question: null,
        activeRevisionId: null,
        designSpecArtifactId: designSpec.id
      };
      completePrototype = true;
    }
    const next = {
      ...current,
      goal: typeof result.goal === "string" ? result.goal.trim().slice(0, 4e3) : current.goal,
      phase,
      status: typeof result.status === "string" ? result.status.trim().slice(0, 1e3) : "The hidden agent processed the latest decision.",
      requirements,
      question: requirements.substage === "usage" ? usageQuestion(requirements.suggestions) : firstActiveQuestion(decisionGraph) || normalizeQuestion(result.question),
      decisionGraph,
      prototypeReview,
      confirmed: normalizeStringList(result.confirmed),
      assumed: normalizeStringList(result.assumed),
      deferred: normalizeStringList(result.deferred),
      artifacts,
      previewUrl,
      previewStatus,
      suggestionProcessing: action === "generate-dag" ? null : current.suggestionProcessing,
      processing: {
        ...current.processing,
        status: "success",
        message: "Processed by a hidden Tandem agent.",
        runId: run.runId,
        completedAt,
        question: null,
        answer: null
      },
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
  if (completePrototype) {
    activePrototypeCompletions.add(prototypeId);
    try {
      await completeLifecycleStage(
        prototypeId,
        "prototype",
        PROVIDER_EXTENSION_ID
      );
    } finally {
      activePrototypeCompletions.delete(prototypeId);
    }
  }
}
async function recordFactoryFailure(prototypeId, requestId, error) {
  await withAnswerClaim(prototypeId, async () => {
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      return;
    }
    const current = await loadState(prototypeId);
    if (current.processing?.status !== "running" || current.processing.requestId !== requestId) {
      return;
    }
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const restoredDecisionGraph = current.processing.action === "change-answer" && current.processing.originalDecisionGraph ? current.processing.originalDecisionGraph : current.decisionGraph;
    const action = current.processing.action;
    const prototypeReview = normalizePrototypeReview(current.prototypeReview);
    if (["submit-revision", "clarify-revision"].includes(action)) {
      const revision = prototypeReview.revisions.find(
        (candidate) => candidate.id === prototypeReview.activeRevisionId
      );
      if (revision) {
        revision.status = action === "clarify-revision" ? "clarifying" : "failed";
        revision.summary = "The prototype revision could not be processed. Retry explicitly.";
        revision.completedAt = action === "submit-revision" ? completedAt : null;
      }
      prototypeReview.question = action === "clarify-revision" ? current.processing.question : null;
      if (action === "submit-revision") {
        prototypeReview.activeRevisionId = null;
      }
    }
    const failed = {
      ...current,
      decisionGraph: restoredDecisionGraph,
      question: current.requirements.substage === "usage" ? usageQuestion(current.requirements.suggestions) : firstActiveQuestion(restoredDecisionGraph),
      prototypeReview,
      status: "Hidden processing failed. Review the answer and try again.",
      processing: {
        ...current.processing,
        status: "error",
        message: "The hidden agent could not process this answer.",
        completedAt,
        answer: null
      },
      updatedAt: completedAt
    };
    await persistState(failed);
    publishState(prototypeId);
  });
  await logSafely(
    `Tandem hidden processing failed: ${error instanceof Error ? error.message : String(error)}`
  );
}
async function settleAnswerRun(prototypeId, requestId, run) {
  let terminalRun = run;
  if (!isFactoryRunTerminal(terminalRun.status)) {
    terminalRun = await session.factory.waitForRun(terminalRun.runId);
  }
  if (terminalRun.status === "halted") {
    terminalRun = await resumeHaltedRun(terminalRun.runId);
  }
  await applyFactoryResult(prototypeId, requestId, terminalRun);
}
async function resumeHaltedRun(runId) {
  for (let attempt = 0; attempt < 305; attempt += 1) {
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      throw new Error(
        "This provider no longer owns hidden answer processing."
      );
    }
    try {
      return await session.factory.resume(runId);
    } catch (error) {
      if (error?.code === "already_active") {
        return session.factory.waitForRun(runId);
      }
      if (error?.code !== "factory_already_running") {
        throw error;
      }
      await new Promise((resolve2) => setTimeout(resolve2, 1e3));
      const current = await session.factory.getRun(runId);
      if (current.status === "running") {
        return session.factory.waitForRun(runId);
      }
      if (current.status !== "halted") {
        return current;
      }
    }
  }
  throw new Error("Timed out waiting to resume the hidden factory run.");
}
function trackAnswerRun(prototypeId, requestId, work) {
  const tracked = work.catch(async (error) => {
    try {
      await recordFactoryFailure(prototypeId, requestId, error);
    } catch (recordError) {
      await logSafely(
        `Tandem could not persist a hidden-processing failure: ${recordError instanceof Error ? recordError.message : String(recordError)}`
      );
    }
  }).finally(() => {
    if (activeAnswerRuns.get(prototypeId) === tracked) {
      activeAnswerRuns.delete(prototypeId);
    }
  });
  activeAnswerRuns.set(prototypeId, tracked);
}
function startAnswerFactory(prototypeId, requestId, question, answer, action, state) {
  const work = runAnswerFactory(
    prototypeId,
    requestId,
    question,
    answer,
    action,
    state
  );
  trackAnswerRun(prototypeId, requestId, work);
}
async function runAnswerFactory(prototypeId, requestId, question, answer, action, state) {
  if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
    return;
  }
  const run = await session.rpc.factory.run({
    name: ANSWER_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      requestId,
      question,
      answer,
      action,
      state: factoryStateSnapshot(state)
    }
  });
  const currentRequest = await recordFactoryRunId(
    prototypeId,
    requestId,
    run.runId,
    ANSWER_FACTORY_NAME
  );
  if (!currentRequest) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  await settleAnswerRun(prototypeId, requestId, run);
}
function recoverAnswerFactory(state, canSubmitAnswers) {
  const processing = state.processing;
  if (!canSubmitAnswers || processing?.status !== "running" || activeAnswerRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    const current = await loadState(state.prototypeId);
    const currentProcessing = current.processing;
    if (currentProcessing?.status !== "running" || currentProcessing.requestId !== processing.requestId) {
      return;
    }
    let run;
    if (currentProcessing.runId) {
      try {
        run = await session.factory.getRun(currentProcessing.runId);
      } catch (error) {
        if (["not_found", "non_resumable"].includes(
          factoryErrorCode(error)
        ) && currentProcessing.factoryName !== ANSWER_FACTORY_NAME && currentProcessing.question && currentProcessing.answer) {
          await runAnswerFactory(
            state.prototypeId,
            currentProcessing.requestId,
            currentProcessing.question,
            currentProcessing.answer,
            currentProcessing.action,
            current
          );
          return;
        }
        throw error;
      }
    } else {
      run = await findAnswerFactoryRun(currentProcessing);
      if (!run) {
        throw new Error(
          "The durable factory run could not be correlated after reload."
        );
      }
      const currentRequest = await recordFactoryRunId(
        state.prototypeId,
        currentProcessing.requestId,
        run.runId,
        currentProcessing.factoryName
      );
      if (!currentRequest) return;
    }
    if (currentProcessing.factoryName !== ANSWER_FACTORY_NAME) {
      if (!isFactoryRunTerminal(run.status)) {
        run = await session.factory.waitForRun(run.runId);
      }
      if (["halted", "cancelled"].includes(run.status)) {
        if (!currentProcessing.question || !currentProcessing.answer) {
          throw new Error(
            "The prior provider stopped before its hidden run could be resumed."
          );
        }
        await runAnswerFactory(
          state.prototypeId,
          currentProcessing.requestId,
          currentProcessing.question,
          currentProcessing.answer,
          currentProcessing.action,
          current
        );
        return;
      }
    }
    await settleAnswerRun(
      state.prototypeId,
      currentProcessing.requestId,
      run
    );
  })();
  trackAnswerRun(state.prototypeId, processing.requestId, work);
}
async function findAnswerFactoryRun(processing) {
  const requestedAt = Date.parse(processing.requestedAt);
  if (!Number.isFinite(requestedAt)) return null;
  const marker = `Request ${processing.requestId};`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runs = await session.factory.listRuns();
    const candidates = runs.filter(
      (run) => run.factoryName === processing.factoryName && run.createdAt >= requestedAt - 1e3 && run.createdAt <= requestedAt + 3e4
    );
    for (const candidate of candidates) {
      const progress = await session.factory.getRunProgress(
        candidate.runId,
        { limit: 500 }
      );
      if (progress.records.some((record) => record.text.includes(marker))) {
        return session.factory.getRun(candidate.runId);
      }
    }
    await new Promise((resolve2) => setTimeout(resolve2, 1e3));
  }
  return null;
}
function trackSuggestionRun(prototypeId, requestId, work) {
  const tracked = work.catch(async (error) => {
    await recordSuggestionFailure(prototypeId, requestId, error);
  }).finally(() => {
    if (activeSuggestionRuns.get(prototypeId) === tracked) {
      activeSuggestionRuns.delete(prototypeId);
    }
  });
  activeSuggestionRuns.set(prototypeId, tracked);
}
function startSuggestionFactory(prototypeId, requestId, goal, usageItems) {
  trackSuggestionRun(
    prototypeId,
    requestId,
    runSuggestionFactory(prototypeId, requestId, goal, usageItems)
  );
}
async function ensureUsageSuggestionsStarted(state, canSubmitAnswers) {
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "requirements" || state.requirements.substage !== "usage" || state.requirements.suggestions.length > 0 || state.suggestionProcessing || activeSuggestionRuns.has(state.prototypeId)) {
    return state;
  }
  let request = null;
  const nextState = await withAnswerClaim(state.prototypeId, async () => {
    const current = await loadState(state.prototypeId);
    if (current.lifecycle.currentStage !== "requirements" || current.requirements.substage !== "usage" || current.requirements.suggestions.length > 0 || current.suggestionProcessing || current.processing?.status === "running") {
      return current;
    }
    const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
    const requestId = randomUUID();
    const usageItems = [...current.requirements.usageItems];
    const next = {
      ...current,
      status: usageItems.length === 0 ? "Generating starter usage suggestions in the background..." : "Generating usage suggestions in the background...",
      suggestionProcessing: {
        status: "running",
        message: "Generating suggestions without blocking usage entry.",
        requestId,
        factoryName: SUGGESTION_FACTORY_NAME,
        runId: null,
        usageItems,
        requestedAt,
        completedAt: null
      },
      updatedAt: requestedAt
    };
    await persistState(next);
    publishState(current.prototypeId);
    request = {
      prototypeId: current.prototypeId,
      requestId,
      goal: current.goal,
      usageItems
    };
    return next;
  });
  if (request) {
    startSuggestionFactory(
      request.prototypeId,
      request.requestId,
      request.goal,
      request.usageItems
    );
  }
  return nextState;
}
async function runSuggestionFactory(prototypeId, requestId, goal, usageItems) {
  if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) return;
  const run = await session.rpc.factory.run({
    name: SUGGESTION_FACTORY_NAME,
    args: {
      prototypeId,
      requestId,
      goal,
      usageItems
    }
  });
  const currentRequest = await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (current.suggestionProcessing?.status !== "running" || current.suggestionProcessing.requestId !== requestId) {
      return false;
    }
    const next = {
      ...current,
      suggestionProcessing: {
        ...current.suggestionProcessing,
        runId: run.runId
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
  if (!currentRequest) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  let terminalRun = run;
  if (!isFactoryRunTerminal(terminalRun.status)) {
    terminalRun = await session.factory.waitForRun(terminalRun.runId);
  }
  if (terminalRun.status === "halted") {
    terminalRun = await resumeHaltedRun(terminalRun.runId);
  }
  if (terminalRun.status !== "completed" || !isObject(terminalRun.result)) {
    throw new Error(factoryErrorMessage(terminalRun));
  }
  await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (current.suggestionProcessing?.status !== "running" || current.suggestionProcessing.requestId !== requestId || current.requirements.substage !== "usage") {
      return;
    }
    const requirements = normalizeRequirements(
      {
        ...current.requirements,
        suggestions: terminalRun.result.suggestions
      },
      current.decisionGraph
    );
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const next = {
      ...current,
      requirements,
      question: usageQuestion(requirements.suggestions),
      status: "Suggestions are ready. Keep adding usages or generate the DAG.",
      suggestionProcessing: {
        ...current.suggestionProcessing,
        status: "success",
        message: "Suggestions updated.",
        completedAt
      },
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function recordSuggestionFailure(prototypeId, requestId, error) {
  await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (current.suggestionProcessing?.status !== "running" || current.suggestionProcessing.requestId !== requestId) {
      return;
    }
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const hasUsages = current.requirements.usageItems.length > 0;
    const next = {
      ...current,
      status: hasUsages ? "Usage saved, but suggestions could not be refreshed." : "Starter suggestions could not be generated. Add a usage to continue.",
      suggestionProcessing: {
        ...current.suggestionProcessing,
        status: "error",
        message: hasUsages ? "Suggestion generation failed. Add another usage to retry." : "Suggestion generation failed. Add a usage to retry.",
        completedAt
      },
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
  await logSafely(
    `Tandem suggestion generation failed: ${error instanceof Error ? error.message : String(error)}`
  );
}
function recoverSuggestionFactory(state, canSubmitAnswers) {
  const processing = state.suggestionProcessing;
  if (!canSubmitAnswers || processing?.status !== "running" || activeSuggestionRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    if (processing.runId) {
      try {
        let run = await session.factory.getRun(processing.runId);
        if (!isFactoryRunTerminal(run.status)) {
          run = await session.factory.waitForRun(run.runId);
        }
        if (run.status === "halted") {
          run = await resumeHaltedRun(run.runId);
        }
        if (run.status !== "completed" || !isObject(run.result)) {
          throw new Error(factoryErrorMessage(run));
        }
        await withAnswerClaim(state.prototypeId, async () => {
          const current = await loadState(state.prototypeId);
          if (current.suggestionProcessing?.requestId !== processing.requestId) {
            return;
          }
          const requirements = normalizeRequirements(
            {
              ...current.requirements,
              suggestions: run.result.suggestions
            },
            current.decisionGraph
          );
          const completedAt = (/* @__PURE__ */ new Date()).toISOString();
          const next = {
            ...current,
            requirements,
            question: usageQuestion(requirements.suggestions),
            status: "Suggestions are ready. Keep adding usages or generate the DAG.",
            suggestionProcessing: {
              ...current.suggestionProcessing,
              status: "success",
              message: "Suggestions updated.",
              completedAt
            },
            updatedAt: completedAt
          };
          await persistState(next);
          publishState(state.prototypeId);
        });
        return;
      } catch (error) {
        if (!["not_found", "non_resumable"].includes(factoryErrorCode(error))) {
          throw error;
        }
      }
    }
    await runSuggestionFactory(
      state.prototypeId,
      processing.requestId,
      state.goal,
      processing.usageItems
    );
  })();
  trackSuggestionRun(state.prototypeId, processing.requestId, work);
}
function applyArtifactChanges(currentArtifacts, value) {
  if (!isObject(value)) {
    throw new Error("The hidden agent returned invalid artifact changes.");
  }
  if (!Array.isArray(value.upsert) || value.upsert.length > 30) {
    throw new Error("The hidden agent returned too many artifact upserts.");
  }
  if (!Array.isArray(value.remove) || value.remove.length > 50) {
    throw new Error("The hidden agent returned invalid artifact removals.");
  }
  const upsertIds = /* @__PURE__ */ new Set();
  for (const artifact of value.upsert) {
    if (!isValidFactoryArtifact(artifact) || upsertIds.has(artifact.id)) {
      throw new Error("The hidden agent returned an invalid artifact upsert.");
    }
    upsertIds.add(artifact.id);
  }
  for (const id of value.remove) {
    if (typeof id !== "string" || id !== id.trim() || !id || id.length > 120) {
      throw new Error("The hidden agent returned an invalid artifact removal.");
    }
  }
  const removedIds = new Set(normalizeStringList(value.remove));
  const merged = currentArtifacts.filter(
    (artifact) => !removedIds.has(artifact.id)
  );
  const upserts = normalizeArtifacts(value.upsert);
  if (upserts.length !== value.upsert.length) {
    throw new Error("The hidden agent returned an invalid artifact upsert.");
  }
  for (const artifact of upserts) {
    const index = merged.findIndex((candidate) => candidate.id === artifact.id);
    if (index === -1) {
      if (merged.length >= 30) {
        throw new Error(
          "The hidden agent must remove an artifact before adding another."
        );
      }
      merged.push(artifact);
    } else {
      merged[index] = artifact;
    }
  }
  return merged;
}
function isValidFactoryArtifact(value) {
  if (!isObject(value)) return false;
  const limits = {
    id: 120,
    title: 200,
    kind: 80,
    stage: 20,
    path: 500,
    language: 80,
    content: 2e5,
    mermaid: 5e4
  };
  for (const [field, limit] of Object.entries(limits)) {
    if (typeof value[field] !== "string" || value[field].length > limit) {
      return false;
    }
  }
  for (const field of [
    "id",
    "title",
    "kind",
    "stage",
    "path",
    "language",
    "mermaid"
  ]) {
    if (value[field] !== value[field].trim()) return false;
  }
  return Boolean(
    value.id && value.title && value.kind && LIFECYCLE_STAGES.some((stage) => stage.id === value.stage) && value.language
  );
}
function designReviewContext(state) {
  const productReview = normalizeDesignReview(state.designReview);
  const design = normalizeDesign(state.design, productReview);
  const reviewKind = design.substage === "test" ? "test" : "product";
  const reviewKey = reviewKind === "test" ? "testDesignReview" : "designReview";
  return {
    design,
    reviewKind,
    reviewKey,
    review: normalizeDesignReview(state[reviewKey])
  };
}
function seedDefaultProductDesignReview(state, createdAt = (/* @__PURE__ */ new Date()).toISOString()) {
  if (state.lifecycle.currentStage !== "design" || state.design?.substage === "test") {
    return state;
  }
  const review = normalizeDesignReview(state.designReview);
  if (review.threads.length > 0 || review.processing || review.finalizeRequested || review.finalizedArtifactId) {
    return state;
  }
  return {
    ...state,
    designReview: {
      ...review,
      threads: DEFAULT_PRODUCT_DESIGN_REQUESTS.map((request) => ({
        id: request.id,
        type: "artifact",
        artifactKind: request.artifactKind,
        prompt: request.prompt,
        answer: "",
        status: "queued",
        artifactIds: [],
        reviewArtifactId: null,
        createdAt,
        completedAt: null,
        error: ""
      }))
    },
    status: "Generating required project-specific design artifacts for review...",
    updatedAt: createdAt
  };
}
async function ensureDefaultProductDesignReview(state, canSubmitAnswers) {
  if (!canSubmitAnswers) return state;
  return withAnswerClaim(state.prototypeId, async () => {
    const current = await loadState(state.prototypeId);
    const next = seedDefaultProductDesignReview(current);
    if (next === current) return current;
    await persistState(next);
    publishState(state.prototypeId);
    return next;
  });
}
function markDesignArtifactsStale(artifacts, threadId = null, reviewKind = "product") {
  return artifacts.map((artifact) => {
    const dependsOnThread = threadId && artifact.sourceThreadIds.includes(threadId);
    const isFinalArtifact = reviewKind === "test" ? artifact.id === "test-spec" : ["design-spec", "design-review", "test-spec"].includes(
      artifact.id
    );
    if (artifact.stage !== "design" || !isFinalArtifact && !dependsOnThread) {
      return artifact;
    }
    return { ...artifact, reviewStatus: "stale" };
  });
}
async function applyDesignReviewFactoryResult(prototypeId, requestId, run) {
  if (run.status !== "completed" || !isObject(run.result)) {
    throw new Error(factoryErrorMessage(run));
  }
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const context = designReviewContext(state);
    const review = context.review;
    if (!review.processing || review.processing.requestId !== requestId) {
      return;
    }
    const result = run.result;
    const answer = String(result.answer || "").trim().slice(0, 2e4);
    if (!answer || !Array.isArray(result.artifacts)) {
      throw new Error("The Design Review worker returned an invalid result.");
    }
    for (const artifact of result.artifacts) {
      if (!isValidFactoryArtifact(artifact) || artifact.stage !== "design" || !Array.isArray(artifact.sourceThreadIds) || artifact.reviewStatus !== "current") {
        throw new Error(
          "The Design Review worker returned an invalid artifact."
        );
      }
    }
    const artifacts = applyArtifactChanges(state.artifacts, {
      upsert: result.artifacts,
      remove: []
    });
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    let finalizedArtifactId = review.finalizedArtifactId;
    let finalizeRequested = review.finalizeRequested;
    const threads = review.threads.map((thread) => ({ ...thread }));
    let status;
    if (review.processing.action === "finalize") {
      const unresolved = threads.some((thread) => thread.status !== "resolved");
      if (!finalizeRequested || unresolved) {
        const next2 = {
          ...state,
          [context.reviewKey]: {
            ...review,
            processing: null,
            finalizeRequested: false,
            finalizedArtifactId: null
          },
          status: "The final review was superseded by a newer design question.",
          updatedAt: completedAt
        };
        await persistState(next2);
        publishState(prototypeId);
        return;
      }
      const finalArtifact = artifacts.find(
        (artifact) => artifact.id === (context.reviewKind === "test" ? "test-spec" : "design-spec") && artifact.kind === (context.reviewKind === "test" ? "test-spec" : "design-spec") && artifact.stage === "design" && artifact.reviewStatus === "current" && artifact.content.trim()
      );
      if (!finalArtifact) {
        throw new Error(
          `The ${context.reviewKind} design worker did not produce its final specification.`
        );
      }
      const scenarios = context.reviewKind === "test" ? normalizeTestScenarios(result.testScenarios) : review.scenarios;
      if (context.reviewKind === "test" && scenarios.length === 0) {
        throw new Error(
          "The Test Design worker did not return executable test scenarios."
        );
      }
      finalizedArtifactId = finalArtifact.id;
      finalizeRequested = false;
      status = context.reviewKind === "test" ? "Test specification captured. Design can now be completed." : "Design specification captured. Continue with Test design.";
      review.scenarios = scenarios;
    } else {
      const threadId = review.processing.threadId;
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) {
        throw new Error("The active Design Review thread no longer exists.");
      }
      const generatedArtifacts = artifacts.filter(
        (artifact) => result.artifacts.some(
          (candidate) => candidate.id === artifact.id
        ) && artifact.sourceThreadIds.includes(thread.id)
      );
      if (thread.type === "artifact" && generatedArtifacts.length === 0) {
        throw new Error(
          "The Design Review worker did not generate the requested artifact."
        );
      }
      thread.answer = answer;
      thread.status = "answered";
      thread.artifactIds = generatedArtifacts.map((artifact) => artifact.id);
      thread.completedAt = completedAt;
      thread.error = "";
      status = generatedArtifacts.length > 0 ? `Design answer ready with ${generatedArtifacts.length} artifact${generatedArtifacts.length === 1 ? "" : "s"}.` : "Design answer ready for review.";
    }
    const next = {
      ...state,
      artifacts,
      design: review.processing.action === "finalize" && context.reviewKind === "product" ? { substage: "test" } : context.design,
      [context.reviewKey]: {
        threads,
        processing: null,
        finalizeRequested,
        finalizedArtifactId,
        scenarios: review.scenarios
      },
      testing: review.processing.action === "finalize" && context.reviewKind === "test" ? normalizeTesting(
        { status: "idle" },
        { ...review, scenarios: review.scenarios }
      ) : state.testing,
      status,
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function recordDesignReviewFailure(prototypeId, requestId, error) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const context = designReviewContext(state);
    const review = context.review;
    if (!review.processing || review.processing.requestId !== requestId) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const threads = review.threads.map(
      (thread) => thread.id === review.processing.threadId ? {
        ...thread,
        status: "failed",
        error: message.slice(0, 1e3),
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      } : thread
    );
    const next = {
      ...state,
      [context.reviewKey]: {
        threads,
        processing: null,
        finalizeRequested: false,
        finalizedArtifactId: review.finalizedArtifactId,
        scenarios: review.scenarios
      },
      status: `${context.reviewKind === "test" ? "Test Design" : "Product Design"} processing failed: ${message}`,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function claimNextDesignReviewJob(prototypeId) {
  return withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const context = designReviewContext(state);
    const review = context.review;
    if (state.lifecycle.currentStage !== "design" || review.processing) {
      return null;
    }
    const queuedThread = review.threads.find(
      (thread) => thread.status === "queued"
    );
    const action = queuedThread ? "process-thread" : review.finalizeRequested ? "finalize" : null;
    if (!action) return null;
    const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
    const requestId = randomUUID();
    const threads = review.threads.map(
      (thread) => thread.id === queuedThread?.id ? { ...thread, status: "processing", error: "" } : thread
    );
    const processing = {
      requestId,
      action,
      threadId: queuedThread?.id || null,
      runId: null,
      requestedAt
    };
    const pending = {
      ...state,
      [context.reviewKey]: {
        ...review,
        threads,
        processing
      },
      status: action === "finalize" ? `Synthesizing the final ${context.reviewKind} design specification...` : `Answering a ${context.reviewKind} design request...`,
      updatedAt: requestedAt
    };
    await persistState(pending);
    publishState(prototypeId);
    return {
      requestId,
      action,
      thread: queuedThread ? threads.find((thread) => thread.id === queuedThread.id) : null,
      state: pending,
      reviewKind: context.reviewKind
    };
  });
}
async function runDesignReviewJob(prototypeId, job) {
  const run = await session.rpc.factory.run({
    name: DESIGN_REVIEW_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      requestId: job.requestId,
      action: job.action,
      reviewKind: job.reviewKind,
      thread: job.thread,
      state: factoryStateSnapshot(job.state)
    }
  });
  const accepted = await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const context = designReviewContext(state);
    if (context.reviewKind !== job.reviewKind) return false;
    const review = context.review;
    if (review.processing?.requestId !== job.requestId) return false;
    const next = {
      ...state,
      [context.reviewKey]: {
        ...review,
        processing: {
          ...review.processing,
          runId: run.runId
        }
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
  if (!accepted) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  const terminalRun = isFactoryRunTerminal(run.status) ? run : await session.factory.waitForRun(run.runId);
  await applyDesignReviewFactoryResult(
    prototypeId,
    job.requestId,
    terminalRun
  );
}
async function processDesignReviewQueue(prototypeId) {
  while (await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
    const job = await claimNextDesignReviewJob(prototypeId);
    if (!job) return;
    try {
      await runDesignReviewJob(prototypeId, job);
    } catch (error) {
      await recordDesignReviewFailure(
        prototypeId,
        job.requestId,
        error
      );
    }
  }
}
function startDesignReviewQueue(prototypeId) {
  if (activeDesignReviewRuns.has(prototypeId)) return;
  const work = processDesignReviewQueue(prototypeId).catch(
    (error) => logSafely(
      `Tandem Design Review queue failed: ${error instanceof Error ? error.message : String(error)}`
    )
  ).finally(() => {
    if (activeDesignReviewRuns.get(prototypeId) === work) {
      activeDesignReviewRuns.delete(prototypeId);
      void loadState(prototypeId).then((state) => {
        const review = designReviewContext(state).review;
        if (state.lifecycle.currentStage === "design" && (review.finalizeRequested || review.threads.some(
          (thread) => thread.status === "queued"
        ))) {
          startDesignReviewQueue(prototypeId);
        }
      }).catch(
        (error) => logSafely(
          `Tandem could not inspect the Design Review queue: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  });
  activeDesignReviewRuns.set(prototypeId, work);
}
function recoverDesignReviewFactory(state, canSubmitAnswers) {
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "design" || activeDesignReviewRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    const current = await loadState(state.prototypeId);
    let context = designReviewContext(current);
    let review = context.review;
    if (review.processing?.runId) {
      try {
        let run = await session.factory.getRun(review.processing.runId);
        if (!isFactoryRunTerminal(run.status)) {
          run = await session.factory.waitForRun(run.runId);
        }
        await applyDesignReviewFactoryResult(
          state.prototypeId,
          review.processing.requestId,
          run
        );
      } catch (error) {
        await recordDesignReviewFailure(
          state.prototypeId,
          review.processing.requestId,
          error
        );
      }
    } else if (review.processing) {
      await withAnswerClaim(state.prototypeId, async () => {
        const latest = await loadState(state.prototypeId);
        context = designReviewContext(latest);
        const latestReview = context.review;
        if (latestReview.processing?.requestId !== review.processing.requestId) {
          return;
        }
        const threads = latestReview.threads.map(
          (thread) => thread.id === latestReview.processing.threadId ? { ...thread, status: "queued" } : thread
        );
        const next = {
          ...latest,
          [context.reviewKey]: {
            ...latestReview,
            threads,
            processing: null
          },
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await persistState(next);
        publishState(state.prototypeId);
      });
    }
    await processDesignReviewQueue(state.prototypeId);
  })().catch(
    (error) => logSafely(
      `Tandem could not recover Design Review: ${error instanceof Error ? error.message : String(error)}`
    )
  ).finally(() => {
    if (activeDesignReviewRuns.get(state.prototypeId) === work) {
      activeDesignReviewRuns.delete(state.prototypeId);
    }
  });
  activeDesignReviewRuns.set(state.prototypeId, work);
}
function markExecutionPlanStale(artifacts) {
  return artifacts.map(
    (artifact) => artifact.stage === "plan" && artifact.id === "execution-plan" ? { ...artifact, reviewStatus: "stale" } : artifact
  );
}
function markFinalCodeStale(artifacts) {
  return artifacts.map(
    (artifact) => artifact.stage === "implement" && artifact.id === "final-code" ? { ...artifact, reviewStatus: "stale" } : artifact
  );
}
function resetImplementationForPlan(planning, previous = {}) {
  return normalizeImplementation(
    {
      status: "idle",
      strategySuggestions: Array.isArray(previous.strategySuggestions) ? previous.strategySuggestions.filter(
        (suggestion) => suggestion.status === "queued"
      ) : []
    },
    planning
  );
}
function validatePlanningFactoryResult(result) {
  if (!isObject(result) || !String(result.summary || "").trim() || !String(result.strategy || "").trim() || !Array.isArray(result.workItems) || result.workItems.length === 0) {
    throw new Error("The planning worker returned an incomplete execution plan.");
  }
  const ids = /* @__PURE__ */ new Set();
  for (const item of result.workItems) {
    if (!isObject(item) || !String(item.id || "").trim() || ids.has(item.id) || !String(item.title || "").trim() || !String(item.description || "").trim() || !Array.isArray(item.dependencies) || !Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0 || !Array.isArray(item.validation) || item.validation.length === 0) {
      throw new Error(
        "The planning worker returned an invalid implementation work item."
      );
    }
    ids.add(item.id);
  }
  for (const item of result.workItems) {
    if (item.dependencies.some(
      (dependency) => dependency === item.id || !ids.has(dependency)
    )) {
      throw new Error(
        `Work item ${item.id} contains an invalid dependency.`
      );
    }
  }
}
async function applyPlanningFactoryResult(prototypeId, requestId, run) {
  if (run.status !== "completed" || !isObject(run.result)) {
    throw new Error(factoryErrorMessage(run));
  }
  validatePlanningFactoryResult(run.result);
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    if (planning.processing?.requestId !== requestId) return;
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const normalized = normalizePlanning({
      ...planning,
      status: "ready",
      summary: run.result.summary,
      strategy: run.result.strategy,
      workItems: run.result.workItems,
      risks: run.result.risks,
      revisionHistory: planning.processing.action === "revise" && planning.processing.instruction ? [
        ...planning.revisionHistory,
        planning.processing.instruction
      ] : planning.revisionHistory,
      processing: null,
      finalizedArtifactId: null,
      error: ""
    });
    if (normalized.error || normalized.waves.length === 0) {
      throw new Error(
        normalized.error || "The execution plan could not be scheduled."
      );
    }
    const next = {
      ...state,
      artifacts: markFinalCodeStale(
        markExecutionPlanStale(state.artifacts)
      ),
      planning: normalized,
      implementation: resetImplementationForPlan(
        normalized,
        state.implementation
      ),
      status: `Execution plan ready: ${normalized.workItems.length} work items across ${normalized.waves.length} wave${normalized.waves.length === 1 ? "" : "s"}.`,
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function recordPlanningFailure(prototypeId, requestId, error) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    if (planning.processing?.requestId !== requestId) return;
    const message = error instanceof Error ? error.message : String(error);
    const next = {
      ...state,
      planning: {
        ...planning,
        status: "failed",
        processing: null,
        error: message.slice(0, 1e3)
      },
      status: `Execution planning failed: ${message}`,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function runPlanningFactory(prototypeId, requestId, state) {
  const planning = normalizePlanning(state.planning);
  const processing = planning.processing;
  if (!processing || processing.requestId !== requestId) return;
  const run = await session.rpc.factory.run({
    name: PLANNING_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      requestId,
      action: processing.action,
      instruction: processing.instruction,
      maxAgents: planning.maxAgents,
      state: factoryStateSnapshot(state)
    }
  });
  const accepted = await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    const currentPlanning = normalizePlanning(current.planning);
    if (currentPlanning.processing?.requestId !== requestId) return false;
    const next = {
      ...current,
      planning: {
        ...currentPlanning,
        processing: {
          ...currentPlanning.processing,
          runId: run.runId
        }
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
  if (!accepted) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  const terminalRun = isFactoryRunTerminal(run.status) ? run : await session.factory.waitForRun(run.runId);
  await applyPlanningFactoryResult(prototypeId, requestId, terminalRun);
}
function startPlanningFactory(prototypeId, requestId, state) {
  if (activePlanningRuns.has(prototypeId)) return;
  const work = runPlanningFactory(prototypeId, requestId, state).catch(async (error) => {
    try {
      await recordPlanningFailure(prototypeId, requestId, error);
    } catch (recordError) {
      await logSafely(
        `Tandem could not persist the planning failure: ${recordError instanceof Error ? recordError.message : String(recordError)}`
      );
    }
  }).finally(() => {
    if (activePlanningRuns.get(prototypeId) === work) {
      activePlanningRuns.delete(prototypeId);
    }
  });
  activePlanningRuns.set(prototypeId, work);
}
function recoverPlanningFactory(state, canSubmitAnswers) {
  const planning = normalizePlanning(state.planning);
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "plan" || !planning.processing || activePlanningRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    if (planning.processing.runId) {
      try {
        let run = await session.factory.getRun(planning.processing.runId);
        if (!isFactoryRunTerminal(run.status)) {
          run = await session.factory.waitForRun(run.runId);
        }
        await applyPlanningFactoryResult(
          state.prototypeId,
          planning.processing.requestId,
          run
        );
        return;
      } catch (error) {
        if (!["not_found", "non_resumable"].includes(factoryErrorCode(error))) {
          throw error;
        }
      }
    }
    await runPlanningFactory(
      state.prototypeId,
      planning.processing.requestId,
      state
    );
  })().catch(
    (error) => recordPlanningFailure(
      state.prototypeId,
      planning.processing.requestId,
      error
    )
  ).finally(() => {
    if (activePlanningRuns.get(state.prototypeId) === work) {
      activePlanningRuns.delete(state.prototypeId);
    }
  });
  activePlanningRuns.set(state.prototypeId, work);
}
function executionPlanArtifact(state) {
  const planning = normalizePlanning(state.planning);
  const aliases = new Map(
    planning.workItems.map((item, index) => [item.id, `Work${index + 1}`])
  );
  const mermaid = ["flowchart LR"];
  for (const item of planning.workItems) {
    mermaid.push(
      `  ${aliases.get(item.id)}["${item.title.replace(/"/g, "'")}<br/>${item.agentId}"]`
    );
  }
  for (const item of planning.workItems) {
    for (const dependency of item.dependencies) {
      mermaid.push(
        `  ${aliases.get(dependency)} --> ${aliases.get(item.id)}`
      );
    }
  }
  const lines = [
    "# Execution plan",
    "",
    planning.summary,
    "",
    "## Orchestration strategy",
    "",
    planning.strategy,
    "",
    "## Schedule",
    "",
    `- Work items: ${planning.workItems.length}`,
    `- Agents: ${planning.agents.length}`,
    `- Parallel waves: ${planning.waves.length}`,
    `- Total effort: ${planning.metrics.totalEffortHours} hours`,
    `- Scheduled elapsed time: ${planning.metrics.scheduledHours} hours`,
    `- Critical path: ${planning.metrics.criticalPathHours} hours`,
    `- Parallelism saved: ${planning.metrics.parallelismSavingsHours} hours`,
    ""
  ];
  for (const wave of planning.waves) {
    lines.push(
      `### Wave ${wave.index} \xB7 hours ${wave.startHour}-${wave.endHour}`,
      "",
      ...wave.workItemIds.map((id) => {
        const item = planning.workItems.find(
          (candidate) => candidate.id === id
        );
        return `- **${item.title}** (${item.agentId}, ${item.agentRole}, ${item.estimatedHours}h)`;
      }),
      ""
    );
  }
  lines.push("## Work items", "");
  for (const item of planning.workItems) {
    lines.push(
      `### ${item.id}: ${item.title}`,
      "",
      item.description,
      "",
      `- Agent: ${item.agentId} (${item.agentRole})`,
      `- Estimate: ${item.estimatedHours} hours`,
      `- Dependencies: ${item.dependencies.join(", ") || "None"}`,
      `- Files: ${item.files.join(", ") || "To be discovered within owned scope"}`,
      `- Skills: ${item.skills.join(", ") || "General implementation"}`,
      "- Acceptance criteria:",
      ...item.acceptanceCriteria.map((criterion) => `  - ${criterion}`),
      "- Validation:",
      ...item.validation.map((step) => `  - ${step}`),
      ""
    );
  }
  lines.push(
    "## Agent workload",
    "",
    ...planning.agents.map(
      (agent) => `- **${agent.id}**: ${agent.estimatedHours}h across ${agent.workItemIds.join(", ")}; roles: ${agent.roles.join(", ")}`
    ),
    "",
    "## Risks",
    "",
    ...planning.risks.length > 0 ? planning.risks.map((risk) => `- ${risk}`) : ["- No additional planning risks recorded."]
  );
  return {
    id: "execution-plan",
    title: "Execution plan",
    kind: "execution-plan",
    stage: "plan",
    path: "",
    language: "markdown",
    content: lines.join("\n").trim(),
    mermaid: mermaid.join("\n"),
    sourceThreadIds: [],
    reviewStatus: "current"
  };
}
function implementationEvent(type, message) {
  return {
    id: randomUUID(),
    type,
    message,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function implementationPrompt(args, item, strategy, completedHandoffs) {
  return [
    `Implement work item "${item.id}: ${item.title}" in the active workspace.`,
    "",
    `Project root: ${args.projectRoot}`,
    `Assigned role: ${item.agentRole}`,
    `Description: ${item.description}`,
    `Owned files or paths: ${item.files.join(", ") || "Discover the smallest necessary scope."}`,
    `Dependencies: ${item.dependencies.join(", ") || "None"}`,
    "",
    "Acceptance criteria:",
    ...item.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Validation:",
    ...item.validation.map((step) => `- ${step}`),
    "",
    strategy.length > 0 ? `Execution strategy updates:
${strategy.map((entry) => `- ${entry}`).join("\n")}` : "Execution strategy updates: none.",
    completedHandoffs.length > 0 ? `Completed dependency handoffs:
${completedHandoffs.map((entry) => `- ${entry}`).join("\n")}` : "Completed dependency handoffs: none.",
    "",
    "Work directly in the active workspace and fully implement this item. Respect the",
    "owned file scope and avoid editing files assigned to concurrent work items unless",
    "the change is strictly required; report any unavoidable overlap. Preserve existing",
    "user changes. Do not create branches, commits, stashes, or pull requests. Run the",
    "smallest existing validation that proves the acceptance criteria. Return a concise",
    "structured result with every changed file and validation outcome."
  ].join("\n");
}
async function prepareImplementationWave(prototypeId, waveIndex, workItemIds) {
  return withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    const implementation = normalizeImplementation(
      state.implementation,
      planning
    );
    if (!["starting", "running"].includes(implementation.status)) {
      return { runnable: [], strategy: [], stopped: true };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const queued = implementation.strategySuggestions.filter(
      (suggestion) => suggestion.status === "queued"
    );
    const strategy = implementation.strategySuggestions.map(
      (suggestion) => suggestion.text
    );
    let maxConcurrency = planning.maxAgents;
    for (const text of strategy) {
      if (/\b(serial|one at a time|single agent)\b/i.test(text)) {
        maxConcurrency = 1;
        continue;
      }
      const match = text.match(
        /\b(?:max(?:imum)?|limit|use|reduce(?:\s+parallelism)?\s+to)\s*(?:to\s*)?(\d{1,2})\s*(?:agents?)?\b/i
      );
      if (match) {
        maxConcurrency = Math.max(
          1,
          Math.min(planning.maxAgents, Number(match[1]))
        );
      }
    }
    const workById = new Map(
      implementation.workItems.map((item) => [item.id, item])
    );
    const runnable = [];
    for (const id of workItemIds) {
      const planItem = planning.workItems.find((item) => item.id === id);
      const runtime = workById.get(id);
      if (!planItem || !runtime || runtime.status === "completed") continue;
      const dependencyStates = planItem.dependencies.map(
        (dependency) => workById.get(dependency)?.status || "pending"
      );
      if (dependencyStates.some(
        (status) => ["failed", "blocked", "cancelled"].includes(status)
      )) {
        runtime.status = "blocked";
        runtime.blockers = [
          "A prerequisite work item did not complete successfully."
        ];
        runtime.completedAt = now;
        continue;
      }
      if (dependencyStates.some((status) => status !== "completed")) {
        runtime.status = "pending";
        continue;
      }
      runtime.status = "running";
      runtime.startedAt = now;
      runtime.completedAt = null;
      runtime.summary = "";
      runtime.blockers = [];
      runnable.push(planItem);
    }
    runnable.sort((left, right) => {
      const priorityScore = (item) => strategy.filter(
        (text) => /\b(prioritize|first|earlier|urgent)\b/i.test(text) && (text.toLowerCase().includes(item.id.toLowerCase()) || text.toLowerCase().includes(item.title.toLowerCase()))
      ).length;
      return priorityScore(right) - priorityScore(left);
    });
    const runnableIds = new Set(runnable.map((item) => item.id));
    const agents = implementation.agents.filter(
      (agent) => !runnableIds.has(agent.workItemId)
    );
    for (const item of runnable) {
      agents.push({
        id: `work:${item.id}`,
        workItemId: item.id,
        role: item.agentRole,
        status: "running",
        activity: `Implementing ${item.title}`,
        activeMs: 0,
        model: "",
        summary: ""
      });
    }
    const events = [...implementation.events];
    if (queued.length > 0) {
      events.push(
        implementationEvent(
          "strategy",
          `${queued.length} strategy suggestion${queued.length === 1 ? "" : "s"} applied to wave ${waveIndex}.`
        )
      );
    }
    if (runnable.length > 0) {
      events.push(
        implementationEvent(
          "wave",
          `Wave ${waveIndex} started with ${runnable.length} work item${runnable.length === 1 ? "" : "s"}.`
        )
      );
    }
    const nextImplementation = normalizeImplementation(
      {
        ...implementation,
        status: "running",
        currentWaveIndex: waveIndex,
        workItems: [...workById.values()],
        agents,
        strategySuggestions: implementation.strategySuggestions.map(
          (suggestion) => suggestion.status === "queued" ? {
            ...suggestion,
            status: "applied",
            appliedAt: now,
            waveIndex
          } : suggestion
        ),
        events,
        error: ""
      },
      planning
    );
    const next = {
      ...state,
      implementation: nextImplementation,
      status: runnable.length > 0 ? `Implementation wave ${waveIndex} is running.` : state.status,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
    const completedHandoffs = nextImplementation.workItems.filter(
      (item) => item.status === "completed" && runnable.some(
        (candidate) => candidate.dependencies.includes(item.id)
      )
    ).map((item) => `${item.id}: ${item.summary || "completed"}`);
    return {
      runnable,
      strategy,
      completedHandoffs,
      maxConcurrency,
      stopped: false
    };
  });
}
async function recordImplementationWaveResults(prototypeId, waveIndex, planItems, results) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    const implementation = normalizeImplementation(
      state.implementation,
      planning
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const workById = new Map(
      implementation.workItems.map((item) => [item.id, item])
    );
    const agentByItem = new Map(
      implementation.agents.map((agent) => [agent.workItemId, agent])
    );
    let failedCount = 0;
    for (let index = 0; index < planItems.length; index += 1) {
      const item = planItems[index];
      const result = isObject(results[index]) ? results[index] : null;
      const succeeded = result?.status === "completed";
      const runtime = workById.get(item.id);
      if (!runtime) continue;
      runtime.status = succeeded ? "completed" : "failed";
      runtime.summary = String(
        result?.summary || (succeeded ? "Work item completed." : "The implementation agent returned no successful result.")
      ).trim().slice(0, 12e3);
      runtime.filesChanged = normalizeStringList(result?.filesChanged);
      runtime.validation = normalizeStringList(result?.validation);
      runtime.blockers = normalizeStringList(
        result?.blockers || (succeeded ? [] : ["Implementation agent failed."])
      );
      runtime.completedAt = now;
      if (!succeeded) failedCount += 1;
      const agent = agentByItem.get(item.id);
      if (agent) {
        agent.status = succeeded ? "completed" : "failed";
        agent.activity = succeeded ? "Work item complete" : "Work item failed";
        agent.summary = runtime.summary;
      }
    }
    const events = [
      ...implementation.events,
      implementationEvent(
        failedCount > 0 ? "error" : "wave",
        `Wave ${waveIndex} finished: ${planItems.length - failedCount} completed, ${failedCount} failed.`
      )
    ];
    const next = {
      ...state,
      implementation: normalizeImplementation(
        {
          ...implementation,
          workItems: [...workById.values()],
          agents: [...agentByItem.values()],
          events
        },
        planning
      ),
      status: failedCount > 0 ? `Wave ${waveIndex} completed with failures.` : `Wave ${waveIndex} completed.`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
function finalCodeArtifact(state) {
  const implementation = normalizeImplementation(
    state.implementation,
    normalizePlanning(state.planning)
  );
  const changedFiles = [
    ...new Set(
      implementation.workItems.flatMap((item) => item.filesChanged)
    )
  ];
  const lines = [
    "# Final code",
    "",
    `Implementation completed ${implementation.completedAt || "successfully"}.`,
    "",
    "## Work items",
    "",
    ...implementation.workItems.map(
      (item) => `- **${item.id}**: ${item.summary || "Completed"}`
    ),
    "",
    "## Changed files",
    "",
    ...changedFiles.length > 0 ? changedFiles.map((path) => `- \`${path}\``) : ["- Changes are contained in the active workspace."],
    "",
    "## Validation",
    "",
    ...implementation.workItems.flatMap(
      (item) => item.validation.map((entry) => `- ${item.id}: ${entry}`)
    )
  ];
  return {
    id: "final-code",
    title: "Final code",
    kind: "final-code",
    stage: "implement",
    path: ".",
    language: "markdown",
    content: lines.join("\n").trim(),
    mermaid: "",
    sourceThreadIds: [],
    reviewStatus: "current"
  };
}
async function settleImplementationRun(prototypeId, run) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    const implementation = normalizeImplementation(
      state.implementation,
      planning
    );
    if (implementation.runId && implementation.runId !== run.runId) return;
    const result = isObject(run.result) ? run.result : {};
    const allCompleted = implementation.workItems.length > 0 && implementation.workItems.every(
      (item) => item.status === "completed"
    );
    const succeeded = run.status === "completed" && result.status === "completed" && allCompleted;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let artifacts = state.artifacts;
    let finalizedArtifactId = null;
    if (succeeded) {
      const completedImplementation = {
        ...implementation,
        status: "completed",
        completedAt: now
      };
      const artifact = finalCodeArtifact({
        ...state,
        implementation: completedImplementation
      });
      artifacts = normalizeArtifacts([
        artifact,
        ...state.artifacts.filter(
          (candidate) => candidate.id !== artifact.id
        )
      ]);
      finalizedArtifactId = artifact.id;
    } else {
      artifacts = markFinalCodeStale(state.artifacts);
    }
    const status = run.status === "cancelled" ? "cancelled" : succeeded ? "completed" : "failed";
    const error = succeeded ? "" : String(
      result.summary || (run.status === "completed" ? "One or more implementation work items did not complete." : factoryErrorMessage(run))
    ).slice(0, 2e3);
    const next = {
      ...state,
      artifacts,
      implementation: normalizeImplementation(
        {
          ...implementation,
          status,
          completedAt: now,
          finalizedArtifactId,
          error,
          events: [
            ...implementation.events,
            implementationEvent(
              succeeded ? "complete" : "error",
              succeeded ? "Implementation completed and final code was captured." : status === "cancelled" ? "Implementation was stopped." : `Implementation stopped: ${error}`
            )
          ]
        },
        planning
      ),
      status: succeeded ? "Implementation complete. Final code is ready." : status === "cancelled" ? "Implementation stopped." : `Implementation needs attention: ${error}`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function runImplementationFactory(prototypeId, state, resumeFromRunId = null) {
  const planning = normalizePlanning(state.planning);
  const request = {
    name: IMPLEMENTATION_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      plan: planning
    },
    options: {
      limits: {
        maxConcurrentSubagents: planning.maxAgents,
        maxTotalSubagents: 30,
        timeoutSeconds: 3600,
        maxAiCredits: 1024e3
      },
      ...resumeFromRunId ? { resumeFromRunId } : {}
    }
  };
  const run = await session.rpc.factory.run(request);
  const accepted = await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    const currentPlanning = normalizePlanning(current.planning);
    const implementation = normalizeImplementation(
      current.implementation,
      currentPlanning
    );
    if (!["starting", "running"].includes(implementation.status)) {
      return false;
    }
    const next = {
      ...current,
      implementation: {
        ...implementation,
        status: "running",
        runId: run.runId
      },
      status: "Implementation agents are running.",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
  if (!accepted) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  const terminalRun = isFactoryRunTerminal(run.status) ? run : await session.factory.waitForRun(run.runId);
  await settleImplementationRun(prototypeId, terminalRun);
}
function startImplementationFactory(prototypeId, state, resumeFromRunId = null) {
  if (activeImplementationRuns.has(prototypeId)) return;
  const work = runImplementationFactory(prototypeId, state, resumeFromRunId).catch(async (error) => {
    const failedRun = {
      runId: (await loadState(prototypeId)).implementation.runId || resumeFromRunId || "unavailable",
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
    await settleImplementationRun(prototypeId, failedRun);
  }).finally(() => {
    if (activeImplementationRuns.get(prototypeId) === work) {
      activeImplementationRuns.delete(prototypeId);
    }
  });
  activeImplementationRuns.set(prototypeId, work);
}
function recoverImplementationFactory(state, canSubmitAnswers) {
  const implementation = normalizeImplementation(
    state.implementation,
    normalizePlanning(state.planning)
  );
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "implement" || !["starting", "running"].includes(implementation.status) || activeImplementationRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    if (!implementation.runId) {
      await runImplementationFactory(state.prototypeId, state);
      return;
    }
    let run = await session.factory.getRun(implementation.runId);
    if (run.status === "halted") {
      await runImplementationFactory(
        state.prototypeId,
        state,
        implementation.runId
      );
      return;
    }
    if (!isFactoryRunTerminal(run.status)) {
      run = await session.factory.waitForRun(run.runId);
    }
    await settleImplementationRun(state.prototypeId, run);
  })().catch(async (error) => {
    await settleImplementationRun(state.prototypeId, {
      runId: implementation.runId || "unavailable",
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }).finally(() => {
    if (activeImplementationRuns.get(state.prototypeId) === work) {
      activeImplementationRuns.delete(state.prototypeId);
    }
  });
  activeImplementationRuns.set(state.prototypeId, work);
}
function testEvent(type, message) {
  return {
    id: randomUUID(),
    type,
    message,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function markTestResultsStale(artifacts) {
  return artifacts.map(
    (artifact) => artifact.stage === "test" && artifact.id === "test-results" ? { ...artifact, reviewStatus: "stale" } : artifact
  );
}
function testScenarioPrompt(args, scenario, dependencyEvidence) {
  return [
    `Execute ${scenario.type} test scenario "${scenario.id}: ${scenario.title}".`,
    "",
    `Project root: ${args.projectRoot}`,
    `Description: ${scenario.description}`,
    `Expected outcome: ${scenario.expectedOutcome}`,
    "",
    "Steps:",
    ...scenario.steps.map((step) => `- ${step}`),
    "",
    "Validation guidance:",
    ...scenario.validation.map((step) => `- ${step}`),
    "",
    dependencyEvidence.length > 0 ? `Dependency evidence:
${dependencyEvidence.map((entry) => `- ${entry}`).join("\n")}` : "Dependency evidence: none.",
    "",
    "Exercise the implemented application and its real integration boundaries using",
    "the existing repository tooling. Add or update integration/interaction test code",
    "only when the test specification requires it. Preserve user changes. Do not create",
    "branches, commits, stashes, or pull requests. Return passed only when the expected",
    "outcome is observed; otherwise return failed with concrete evidence."
  ].join("\n");
}
async function prepareTestWave(prototypeId, wave) {
  return withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const review = normalizeDesignReview(state.testDesignReview);
    const testing = normalizeTesting(state.testing, review);
    if (!["starting", "running"].includes(testing.status)) return [];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const runtimeById = new Map(
      testing.scenarios.map((scenario) => [scenario.id, scenario])
    );
    const runnable = [];
    for (const id of wave.scenarioIds) {
      const spec = review.scenarios.find((scenario) => scenario.id === id);
      const runtime = runtimeById.get(id);
      if (!spec || !runtime || runtime.status === "passed") continue;
      const dependencyStates = spec.dependencies.map(
        (dependency) => runtimeById.get(dependency)?.status || "pending"
      );
      if (dependencyStates.some((status) => status !== "passed")) {
        runtime.status = dependencyStates.some(
          (status) => ["failed", "blocked"].includes(status)
        ) ? "blocked" : "pending";
        continue;
      }
      runtime.status = "running";
      runtime.startedAt = now;
      runtime.completedAt = null;
      runtime.summary = "";
      runtime.evidence = [];
      runnable.push(spec);
    }
    const runnableIds = new Set(runnable.map((scenario) => scenario.id));
    const agents = testing.agents.filter(
      (agent) => !runnableIds.has(agent.scenarioId)
    );
    for (const scenario of runnable) {
      agents.push({
        id: `test:${scenario.id}`,
        scenarioId: scenario.id,
        status: "running",
        activity: `Running ${scenario.title}`,
        summary: ""
      });
    }
    const next = {
      ...state,
      testing: normalizeTesting(
        {
          ...testing,
          status: "running",
          currentWaveIndex: wave.index,
          scenarios: [...runtimeById.values()],
          agents,
          events: [
            ...testing.events,
            testEvent(
              "wave",
              `Test wave ${wave.index} started with ${runnable.length} scenario${runnable.length === 1 ? "" : "s"}.`
            )
          ]
        },
        review
      ),
      status: `Test wave ${wave.index} is running.`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
    return runnable;
  });
}
async function recordTestWaveResults(prototypeId, wave, specs, results) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const review = normalizeDesignReview(state.testDesignReview);
    const testing = normalizeTesting(state.testing, review);
    const runtimeById = new Map(
      testing.scenarios.map((scenario) => [scenario.id, scenario])
    );
    const agentsById = new Map(
      testing.agents.map((agent) => [agent.scenarioId, agent])
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let failed = 0;
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const result = isObject(results[index]) ? results[index] : null;
      const passed = result?.status === "passed";
      const runtime = runtimeById.get(spec.id);
      if (!runtime) continue;
      runtime.status = passed ? "passed" : "failed";
      runtime.summary = String(
        result?.summary || (passed ? "Scenario passed." : "The test agent returned no passing result.")
      ).trim().slice(0, 12e3);
      runtime.evidence = normalizeStringList(
        result?.evidence || (passed ? [] : ["No passing evidence was returned."])
      );
      runtime.completedAt = now;
      if (!passed) failed += 1;
      const agent = agentsById.get(spec.id);
      if (agent) {
        agent.status = passed ? "passed" : "failed";
        agent.activity = passed ? "Scenario passed" : "Scenario failed";
        agent.summary = runtime.summary;
      }
    }
    const next = {
      ...state,
      testing: normalizeTesting(
        {
          ...testing,
          scenarios: [...runtimeById.values()],
          agents: [...agentsById.values()],
          events: [
            ...testing.events,
            testEvent(
              failed > 0 ? "error" : "wave",
              `Test wave ${wave.index} finished: ${specs.length - failed} passed, ${failed} failed.`
            )
          ]
        },
        review
      ),
      status: failed > 0 ? `Test wave ${wave.index} completed with failures.` : `Test wave ${wave.index} passed.`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
function testResultsArtifact(state) {
  const review = normalizeDesignReview(state.testDesignReview);
  const testing = normalizeTesting(state.testing, review);
  return {
    id: "test-results",
    title: "Integration and interaction test results",
    kind: "test-results",
    stage: "test",
    path: ".",
    language: "markdown",
    content: [
      "# Integration and interaction test results",
      "",
      `Completed ${testing.completedAt || "successfully"}.`,
      "",
      ...testing.scenarios.flatMap((runtime) => {
        const spec = review.scenarios.find(
          (scenario) => scenario.id === runtime.id
        );
        return [
          `## ${spec?.title || runtime.id}`,
          "",
          `- Type: ${spec?.type || "test"}`,
          `- Status: ${runtime.status}`,
          `- Summary: ${runtime.summary || "Passed"}`,
          ...runtime.evidence.map((entry) => `- Evidence: ${entry}`),
          ""
        ];
      })
    ].join("\n").trim(),
    mermaid: "",
    sourceThreadIds: [],
    reviewStatus: "current"
  };
}
async function settleTestRun(prototypeId, run) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const review = normalizeDesignReview(state.testDesignReview);
    const testing = normalizeTesting(state.testing, review);
    if (testing.runId && testing.runId !== run.runId) return;
    const result = isObject(run.result) ? run.result : {};
    const passed = run.status === "completed" && result.status === "passed" && testing.scenarios.length > 0 && testing.scenarios.every((scenario) => scenario.status === "passed");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let artifacts = markTestResultsStale(state.artifacts);
    let finalizedArtifactId = null;
    if (passed) {
      const completedTesting = {
        ...testing,
        status: "completed",
        completedAt: now
      };
      const artifact = testResultsArtifact({
        ...state,
        testing: completedTesting
      });
      artifacts = normalizeArtifacts([
        artifact,
        ...state.artifacts.filter(
          (candidate) => candidate.id !== artifact.id
        )
      ]);
      finalizedArtifactId = artifact.id;
    }
    const error = passed ? "" : String(
      result.summary || (run.status === "completed" ? "One or more test scenarios failed." : factoryErrorMessage(run))
    ).slice(0, 2e3);
    const next = {
      ...state,
      artifacts,
      testing: normalizeTesting(
        {
          ...testing,
          status: passed ? "completed" : "failed",
          completedAt: now,
          finalizedArtifactId,
          error,
          events: [
            ...testing.events,
            testEvent(
              passed ? "complete" : "error",
              passed ? "All integration and interaction tests passed." : `Test execution stopped: ${error}`
            )
          ]
        },
        review
      ),
      status: passed ? "All integration and interaction tests passed." : `Tests need attention: ${error}`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function runTestFactory(prototypeId, state, resumeFromRunId = null) {
  const review = normalizeDesignReview(state.testDesignReview);
  const run = await session.rpc.factory.run({
    name: TEST_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      scenarios: review.scenarios
    },
    options: {
      limits: {
        maxConcurrentSubagents: 4,
        maxTotalSubagents: 30,
        timeoutSeconds: 3600,
        maxAiCredits: 1024e3
      },
      ...resumeFromRunId ? { resumeFromRunId } : {}
    }
  });
  const accepted = await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    const currentReview = normalizeDesignReview(current.testDesignReview);
    const testing = normalizeTesting(current.testing, currentReview);
    if (!["starting", "running"].includes(testing.status)) return false;
    const next = {
      ...current,
      testing: { ...testing, status: "running", runId: run.runId },
      status: "Integration and interaction tests are running.",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
  if (!accepted) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  const terminal = isFactoryRunTerminal(run.status) ? run : await session.factory.waitForRun(run.runId);
  await settleTestRun(prototypeId, terminal);
}
function startTestFactory(prototypeId, state, resumeFromRunId = null) {
  if (activeTestRuns.has(prototypeId)) return;
  const work = runTestFactory(prototypeId, state, resumeFromRunId).catch(async (error) => {
    const latest = await loadState(prototypeId);
    await settleTestRun(prototypeId, {
      runId: latest.testing.runId || resumeFromRunId || "unavailable",
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }).finally(() => {
    if (activeTestRuns.get(prototypeId) === work) {
      activeTestRuns.delete(prototypeId);
    }
  });
  activeTestRuns.set(prototypeId, work);
}
function recoverTestFactory(state, canSubmitAnswers) {
  const review = normalizeDesignReview(state.testDesignReview);
  const testing = normalizeTesting(state.testing, review);
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "test" || !["starting", "running"].includes(testing.status) || activeTestRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    if (!testing.runId) {
      await runTestFactory(state.prototypeId, state);
      return;
    }
    let run = await session.factory.getRun(testing.runId);
    if (run.status === "halted") {
      await runTestFactory(state.prototypeId, state, testing.runId);
      return;
    }
    if (!isFactoryRunTerminal(run.status)) {
      run = await session.factory.waitForRun(run.runId);
    }
    await settleTestRun(state.prototypeId, run);
  })().catch(async (error) => {
    await settleTestRun(state.prototypeId, {
      runId: testing.runId || "unavailable",
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }).finally(() => {
    if (activeTestRuns.get(state.prototypeId) === work) {
      activeTestRuns.delete(state.prototypeId);
    }
  });
  activeTestRuns.set(state.prototypeId, work);
}
async function submitUsage(entry, answer, res) {
  let accepted;
  try {
    accepted = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "requirements" || state.requirements.substage !== "usage") {
        throw new AnswerRequestError(409, "Usage intake is no longer active.");
      }
      if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "The requirements DAG is currently being updated."
        );
      }
      if (answer.length > 500 || /[\r\n]/.test(answer)) {
        throw new AnswerRequestError(
          400,
          "Enter one usage sentence of 500 characters or fewer."
        );
      }
      if (state.requirements.usageItems.length >= 30) {
        throw new AnswerRequestError(
          409,
          "Usage intake supports up to 30 items."
        );
      }
      if (state.requirements.usageItems.some(
        (item) => item.toLowerCase() === answer.toLowerCase()
      )) {
        throw new AnswerRequestError(409, "That usage is already listed.");
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID();
      const usageItems = [...state.requirements.usageItems, answer];
      const next = {
        ...state,
        requirements: {
          ...state.requirements,
          usageItems
        },
        status: "Usage added. Generating fresh suggestions in the background...",
        suggestionProcessing: {
          status: "running",
          message: "Generating suggestions without blocking usage entry.",
          requestId,
          factoryName: SUGGESTION_FACTORY_NAME,
          runId: null,
          usageItems,
          requestedAt,
          completedAt: null
        },
        updatedAt: requestedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return { requestId, state: next, usageItems };
    }, true);
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true, usageItems: accepted.usageItems });
  startSuggestionFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.state.goal,
    accepted.usageItems
  );
}
async function submitPrototypeRevision(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const suggestion = String(body.suggestion || "").trim().slice(0, 4e3);
  if (!suggestion) {
    sendJson(res, 400, { error: "Enter a prototype revision suggestion." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Submit revisions from the installed user-scoped Tandem."
    });
    return;
  }
  let accepted;
  try {
    accepted = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "prototype") {
        throw new AnswerRequestError(
          409,
          "Prototype revisions are only available during Prototype."
        );
      }
      if (state.previewStatus !== "ready") {
        throw new AnswerRequestError(
          409,
          "Wait for the runnable preview before suggesting a revision."
        );
      }
      if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "A previous prototype revision is still being processed."
        );
      }
      if (state.prototypeReview.question) {
        throw new AnswerRequestError(
          409,
          "Answer the open clarification before adding another revision."
        );
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID();
      const revisionId = randomUUID();
      const question = {
        id: `prototype-revision-${revisionId}`,
        text: "Apply this prototype revision, asking for clarification only if needed.",
        rationale: "",
        choices: [],
        recommended: null,
        allowFreeText: true,
        answerPlaceholder: ""
      };
      const prototypeReview = normalizePrototypeReview({
        ...state.prototypeReview,
        revisions: [
          ...state.prototypeReview.revisions,
          {
            id: revisionId,
            suggestion,
            status: "processing",
            summary: "",
            clarifications: [],
            submittedAt: requestedAt,
            completedAt: null
          }
        ],
        activeRevisionId: revisionId,
        question: null
      });
      const pending = {
        ...state,
        phase: "iterating",
        status: "Reviewing the revision and updating the prototype...",
        prototypeReview,
        processing: {
          status: "running",
          action: "submit-revision",
          message: "A hidden agent is reviewing the prototype revision.",
          requestId,
          factoryName: ANSWER_FACTORY_NAME,
          answer: suggestion,
          runId: null,
          requestedAt,
          completedAt: null,
          question,
          originalDecisionGraph: null
        },
        updatedAt: requestedAt
      };
      await persistState(pending);
      publishState(entry.prototypeId);
      return { pending, question, requestId };
    }, true);
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startAnswerFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.question,
    suggestion,
    "submit-revision",
    accepted.pending
  );
}
async function submitRevisionClarification(entry, questionId, answer, res) {
  let accepted;
  try {
    accepted = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      const question = state.prototypeReview.question;
      if (state.lifecycle.currentStage !== "prototype" || !state.prototypeReview.activeRevisionId || !question || question.id !== questionId) {
        throw new AnswerRequestError(
          409,
          "This prototype clarification is no longer active."
        );
      }
      if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "A previous prototype revision is still being processed."
        );
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID();
      const pending = {
        ...state,
        phase: "iterating",
        status: "Applying the clarified prototype revision...",
        processing: {
          status: "running",
          action: "clarify-revision",
          message: "A hidden agent is applying the clarification.",
          requestId,
          factoryName: ANSWER_FACTORY_NAME,
          answer,
          runId: null,
          requestedAt,
          completedAt: null,
          question,
          originalDecisionGraph: null
        },
        prototypeReview: {
          ...state.prototypeReview,
          question: null
        },
        updatedAt: requestedAt
      };
      await persistState(pending);
      publishState(entry.prototypeId);
      return { pending, question, requestId };
    }, true);
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startAnswerFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.question,
    answer,
    "clarify-revision",
    accepted.pending
  );
}
async function beginPrototypeCompletion(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    throw new CanvasError(
      "read_only_provider",
      "Finish Prototype from the installed user-scoped Tandem."
    );
  }
  const accepted = await withAnswerClaim(entry.prototypeId, async () => {
    const state = await loadState(entry.prototypeId);
    if (state.lifecycle.currentStage !== "prototype") {
      throw new CanvasError(
        "stage_not_active",
        "Only the active Prototype stage can be completed."
      );
    }
    if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
      throw new CanvasError(
        "processing_in_progress",
        "Wait for the active prototype revision to finish."
      );
    }
    const blocker = stageCompletionError(state, "prototype", {
      requirePrototypeSpec: false
    });
    if (blocker) throw new CanvasError("stage_not_ready", blocker);
    const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
    const requestId = randomUUID();
    const question = {
      id: "generate-design-spec",
      text: "Generate the evidence-backed draft feature specification.",
      rationale: "",
      choices: [],
      recommended: null,
      allowFreeText: false,
      answerPlaceholder: ""
    };
    const pending = {
      ...state,
      status: "Collecting prototype evidence and generating the draft feature specification...",
      processing: {
        status: "running",
        action: "generate-design-spec",
        message: "A hidden agent is preparing the draft feature specification.",
        requestId,
        factoryName: ANSWER_FACTORY_NAME,
        answer: "Finish Prototype and generate the draft feature specification.",
        runId: null,
        requestedAt,
        completedAt: null,
        question,
        originalDecisionGraph: null
      },
      updatedAt: requestedAt
    };
    await persistState(pending);
    publishState(entry.prototypeId);
    return { pending, question, requestId };
  }, true);
  sendJson(res, 202, { accepted: true });
  startAnswerFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.question,
    accepted.pending.processing.answer,
    "generate-design-spec",
    accepted.pending
  );
}
async function submitAnswer(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const questionId = String(body.questionId || "").trim();
  const answer = String(body.answer || "").trim().slice(0, 4e3);
  const requestedAction = String(body.action || "").trim();
  if (!answer) {
    sendJson(res, 400, { error: "Choose or enter an answer." });
    return;
  }
  if (requestedAction && !ANSWER_ACTIONS.has(requestedAction)) {
    sendJson(res, 400, { error: "This requirements action is not supported." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Submit this answer from the installed user-scoped Tandem."
    });
    return;
  }
  if (requestedAction === "add-usage") {
    await submitUsage(entry, answer, res);
    return;
  }
  if (requestedAction === "clarify-revision") {
    await submitRevisionClarification(entry, questionId, answer, res);
    return;
  }
  let accepted;
  try {
    accepted = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "requirements") {
        throw new AnswerRequestError(
          409,
          "Requirement decisions can only change during requirements collection."
        );
      }
      const decisionGraph = normalizeDecisionGraph(
        state.decisionGraph,
        state.question
      );
      const decisionNode = decisionGraph.nodes.find(
        (node) => node.id === questionId
      );
      const isUsageIntake = state.requirements.substage === "usage" && questionId === USAGE_QUESTION_ID;
      const action = requestedAction || (isUsageIntake ? "add-usage" : "answer-decision");
      const canChangeDecision = action === "change-answer" && decisionNode?.status === "answered";
      const canAnswerDecision = action === "answer-decision" && decisionNode?.status === "active";
      const question = isUsageIntake ? usageQuestion(state.requirements.suggestions) : canAnswerDecision || canChangeDecision ? decisionNode.question : null;
      if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "A previous answer is still being processed."
        );
      }
      if (isUsageIntake && action !== "generate-dag") {
        throw new AnswerRequestError(409, "This usage action is not active.");
      }
      if (action === "generate-dag" && state.requirements.usageItems.length === 0) {
        throw new AnswerRequestError(
          409,
          "Add at least one usage before generating the DAG."
        );
      }
      if (!question || question.id !== questionId) {
        throw new AnswerRequestError(
          409,
          "This question is no longer active."
        );
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID();
      const pendingDecisionGraph = action === "change-answer" ? invalidateDependentNodes(decisionGraph, questionId) : decisionGraph;
      const pending = {
        ...state,
        question: null,
        decisionGraph: pendingDecisionGraph,
        status: action === "add-usage" ? "Adding the usage and generating fresh suggestions..." : action === "generate-dag" ? "Generating the requirements DAG from your usages..." : action === "change-answer" ? "Updating this frontier and all dependent decisions..." : "Applying the answer and preparing the next active decision...",
        processing: {
          status: "running",
          message: PROCESSING_MESSAGES[action] || "Applying the requested Tandem update.",
          action,
          requestId,
          factoryName: ANSWER_FACTORY_NAME,
          answer,
          runId: null,
          requestedAt,
          completedAt: null,
          question,
          originalDecisionGraph: action === "change-answer" ? decisionGraph : null
        },
        updatedAt: requestedAt
      };
      await persistState(pending);
      publishState(entry.prototypeId);
      return { pending, question, requestId, action };
    }, true);
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startAnswerFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.question,
    answer,
    accepted.action,
    accepted.pending
  );
}
async function markReloadComplete(state, extensionId) {
  if (extensionId !== USER_EXTENSION_ID) return state;
  return withAnswerClaim(state.prototypeId, async () => {
    const current = await loadState(state.prototypeId);
    const receipt = current.reloadReceipt;
    if (receipt?.status !== "reloading") return current;
    const requestedAt = Date.parse(receipt.requestedAt);
    if (!Number.isFinite(requestedAt) || PROCESS_STARTED_AT <= requestedAt) {
      return current;
    }
    const completed = {
      ...current,
      reloadReceipt: {
        ...receipt,
        status: "success",
        message: "Reloaded the latest installed user extension.",
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(completed);
    return completed;
  });
}
async function recordReloadError(prototypeId, error) {
  const message = error instanceof Error ? error.message : String(error);
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const failed = {
      ...state,
      reloadReceipt: {
        status: "error",
        message,
        requestedAt: state.reloadReceipt?.requestedAt || (/* @__PURE__ */ new Date()).toISOString(),
        completedAt: (/* @__PURE__ */ new Date()).toISOString(),
        extensionId: USER_EXTENSION_ID
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(failed);
    publishState(prototypeId);
  });
  await logSafely(`Tandem extension reload failed: ${message}`);
}
async function submitReload(entry, res) {
  if (entry.extensionId !== USER_EXTENSION_ID) {
    sendJson(res, 409, {
      error: "Reload is available only from the installed user-scoped Tandem."
    });
    return;
  }
  let extensionList;
  try {
    extensionList = await session.rpc.extensions.list();
  } catch (error) {
    sendJson(res, 500, {
      error: `Could not check the installed extension: ${error instanceof Error ? error.message : String(error)}`
    });
    return;
  }
  const installed = extensionList.extensions.find(
    (extension) => extension.id === USER_EXTENSION_ID
  );
  if (!installed || installed.status !== "running") {
    sendJson(res, 409, {
      error: installed ? `The installed user extension is ${installed.status}.` : "The installed user extension is not available in this session."
    });
    return;
  }
  const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
  await withAnswerClaim(entry.prototypeId, async () => {
    const state = await loadState(entry.prototypeId);
    const reloading = {
      ...state,
      reloadReceipt: {
        status: "reloading",
        message: "Reloading the latest installed user extension...",
        requestedAt,
        completedAt: null,
        extensionId: USER_EXTENSION_ID
      },
      updatedAt: requestedAt
    };
    await persistState(reloading);
    publishState(entry.prototypeId);
  });
  sendJson(res, 202, { accepted: true, requestedAt });
  setTimeout(() => {
    session.rpc.extensions.reload().catch((error) => {
      recordReloadError(entry.prototypeId, error).catch((recordError) => {
        console.error(
          `Tandem could not record a reload failure: ${recordError instanceof Error ? recordError.message : String(recordError)}`
        );
      });
    });
  }, 150);
}
async function submitStageCompletion(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
    const stageId = String(body.stageId || "");
    if (stageId === "prototype") {
      await beginPrototypeCompletion(entry, res);
      return;
    }
    const state = await completeLifecycleStage(
      entry.prototypeId,
      stageId,
      entry.extensionId
    );
    sendJson(res, 200, publicState(entry, state));
  } catch (error) {
    if (error instanceof CanvasError) {
      sendJson(res, 409, { error: error.message, code: error.code });
      return;
    }
    throw error;
  }
}
async function submitDesignReviewRequest(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const prompt = String(body.prompt || "").trim().slice(0, 4e3);
  const type = body.type === "artifact" ? "artifact" : "question";
  const artifactKind = type === "artifact" && ["diagram", "contract", "decision-record", "test-scenario"].includes(
    body.artifactKind
  ) ? body.artifactKind : null;
  const reviewArtifactId = String(body.artifactId || "").trim().slice(0, 120);
  if (!prompt) {
    sendJson(res, 400, { error: "Enter a design question or artifact request." });
    return;
  }
  if (type === "artifact" && !artifactKind) {
    sendJson(res, 400, { error: "Choose the design artifact to generate." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for Design Review."
    });
    return;
  }
  try {
    await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "design") {
        throw new AnswerRequestError(
          409,
          "Design Review is available only during Design."
        );
      }
      const context = designReviewContext(state);
      const review = context.review;
      if (reviewArtifactId && !state.artifacts.some(
        (artifact) => artifact.id === reviewArtifactId && artifact.stage === "design"
      )) {
        throw new AnswerRequestError(
          409,
          "The selected design artifact is no longer available."
        );
      }
      if (review.threads.length >= 100) {
        throw new AnswerRequestError(
          409,
          "Resolve the current review before adding more questions."
        );
      }
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      const thread = {
        id: randomUUID(),
        type,
        artifactKind,
        prompt,
        answer: "",
        status: "queued",
        artifactIds: [],
        reviewArtifactId: reviewArtifactId || null,
        createdAt,
        completedAt: null,
        error: ""
      };
      const next = {
        ...state,
        artifacts: markDesignArtifactsStale(
          state.artifacts,
          null,
          context.reviewKind
        ),
        [context.reviewKey]: {
          ...review,
          threads: [...review.threads, thread],
          finalizeRequested: false,
          finalizedArtifactId: null
        },
        status: type === "artifact" ? `${context.reviewKind === "test" ? "Test design" : "Product design"} artifact request queued.` : `${context.reviewKind === "test" ? "Test design" : "Product design"} question queued.`,
        updatedAt: createdAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startDesignReviewQueue(entry.prototypeId);
}
async function submitDesignThreadAction(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const threadId = String(body.threadId || "").trim();
  const action = String(body.action || "").trim();
  if (!threadId || !["resolve", "reopen", "retry"].includes(action)) {
    sendJson(res, 400, { error: "Invalid Design Review thread action." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for Design Review."
    });
    return;
  }
  let shouldStartQueue = false;
  try {
    const state = await withAnswerClaim(entry.prototypeId, async () => {
      const current = await loadState(entry.prototypeId);
      if (current.lifecycle.currentStage !== "design") {
        throw new AnswerRequestError(
          409,
          "Design Review is available only during Design."
        );
      }
      const context = designReviewContext(current);
      const review = context.review;
      const thread = review.threads.find(
        (candidate) => candidate.id === threadId
      );
      if (!thread) {
        throw new AnswerRequestError(404, "Design Review thread not found.");
      }
      let nextStatus;
      if (action === "resolve" && thread.status === "answered") {
        nextStatus = "resolved";
      } else if (action === "reopen" && thread.status === "resolved") {
        nextStatus = "answered";
      } else if (action === "retry" && thread.status === "failed") {
        nextStatus = "queued";
        shouldStartQueue = true;
      } else {
        throw new AnswerRequestError(
          409,
          `The ${action} action is not available for this thread.`
        );
      }
      const threads = review.threads.map(
        (candidate) => candidate.id === threadId ? {
          ...candidate,
          status: nextStatus,
          error: action === "retry" ? "" : candidate.error
        } : candidate
      );
      const invalidatesReview = action !== "resolve";
      const next = {
        ...current,
        artifacts: invalidatesReview ? markDesignArtifactsStale(
          current.artifacts,
          threadId,
          context.reviewKind
        ) : current.artifacts,
        [context.reviewKey]: {
          ...review,
          threads,
          finalizeRequested: invalidatesReview ? false : review.finalizeRequested,
          finalizedArtifactId: invalidatesReview ? null : review.finalizedArtifactId
        },
        status: action === "resolve" ? `${context.reviewKind === "test" ? "Test design" : "Product design"} answer resolved.` : action === "reopen" ? `${context.reviewKind === "test" ? "Test design" : "Product design"} answer reopened for follow-up.` : `${context.reviewKind === "test" ? "Test design" : "Product design"} request queued for retry.`,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
    sendJson(res, 200, publicState(entry, state));
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  if (shouldStartQueue) startDesignReviewQueue(entry.prototypeId);
}
async function submitDesignReviewFinalization(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for Design Review."
    });
    return;
  }
  try {
    await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "design") {
        throw new AnswerRequestError(
          409,
          "Only the active Design stage can be reviewed."
        );
      }
      const context = designReviewContext(state);
      const review = context.review;
      if (review.processing || review.threads.some((thread) => thread.status !== "resolved")) {
        throw new AnswerRequestError(
          409,
          "Resolve every answered question and wait for queued work before finishing the review."
        );
      }
      const next = {
        ...state,
        artifacts: markDesignArtifactsStale(
          state.artifacts,
          null,
          context.reviewKind
        ),
        [context.reviewKey]: {
          ...review,
          finalizeRequested: true,
          finalizedArtifactId: null
        },
        status: `Final ${context.reviewKind} design specification requested.`,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await persistState(next);
      publishState(entry.prototypeId);
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startDesignReviewQueue(entry.prototypeId);
}
async function submitPlanningRequest(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const requestedAction = body.action === "revise" ? "revise" : "generate";
  const instruction = String(body.instruction || "").trim().slice(0, 4e3);
  const maxAgents = Math.max(
    1,
    Math.min(30, Number.parseInt(body.maxAgents, 10) || 4)
  );
  if (requestedAction === "revise" && !instruction) {
    sendJson(res, 400, { error: "Describe how the execution plan should change." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for execution planning."
    });
    return;
  }
  let pending;
  try {
    pending = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "plan") {
        throw new AnswerRequestError(
          409,
          "Execution planning is available only during Plan."
        );
      }
      const planning = normalizePlanning(state.planning);
      if (planning.processing || activePlanningRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "Wait for the active execution-planning request to finish."
        );
      }
      if (requestedAction === "revise" && planning.workItems.length === 0) {
        throw new AnswerRequestError(
          409,
          "Generate the initial execution plan before revising it."
        );
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID();
      const next = {
        ...state,
        artifacts: markExecutionPlanStale(state.artifacts),
        planning: {
          ...planning,
          status: requestedAction === "revise" ? "revising" : "generating",
          maxAgents,
          processing: {
            requestId,
            action: requestedAction,
            instruction: instruction || "Generate an efficient implementation execution plan.",
            runId: null,
            requestedAt
          },
          finalizedArtifactId: null,
          error: ""
        },
        status: requestedAction === "revise" ? "Revising the execution plan..." : "Generating the execution plan...",
        updatedAt: requestedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startPlanningFactory(
    entry.prototypeId,
    pending.planning.processing.requestId,
    pending
  );
}
async function submitPlanningFinalization(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for execution planning."
    });
    return;
  }
  try {
    const state = await withAnswerClaim(entry.prototypeId, async () => {
      const current = await loadState(entry.prototypeId);
      if (current.lifecycle.currentStage !== "plan") {
        throw new AnswerRequestError(
          409,
          "Only the active Plan stage can be finalized."
        );
      }
      const planning = normalizePlanning(current.planning);
      if (planning.processing || planning.status !== "ready" || planning.workItems.length === 0 || planning.waves.length === 0) {
        throw new AnswerRequestError(
          409,
          "Generate a valid execution plan before finalizing it."
        );
      }
      if (current.artifacts.length >= 30 && !current.artifacts.some(
        (artifact2) => artifact2.id === "execution-plan"
      )) {
        throw new AnswerRequestError(
          409,
          "Remove one artifact before capturing the execution plan."
        );
      }
      const artifact = executionPlanArtifact(current);
      const artifacts = normalizeArtifacts([
        artifact,
        ...current.artifacts.filter(
          (candidate) => candidate.id !== artifact.id
        )
      ]);
      const completedAt = (/* @__PURE__ */ new Date()).toISOString();
      const next = {
        ...current,
        artifacts,
        planning: {
          ...planning,
          status: "complete",
          processing: null,
          finalizedArtifactId: artifact.id,
          error: ""
        },
        implementation: resetImplementationForPlan(
          planning,
          current.implementation
        ),
        status: "Execution plan captured. Plan can now be completed.",
        updatedAt: completedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
    sendJson(res, 200, publicState(entry, state));
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
}
async function submitImplementationStart(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to run implementation."
    });
    return;
  }
  let pending;
  try {
    pending = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      const planning = normalizePlanning(state.planning);
      if (state.lifecycle.currentStage !== "implement") {
        throw new AnswerRequestError(
          409,
          "Implementation can start only during the Implement stage."
        );
      }
      if (planning.status !== "complete" || planning.finalizedArtifactId !== "execution-plan") {
        throw new AnswerRequestError(
          409,
          "Finalize the execution plan before starting implementation."
        );
      }
      const implementation = normalizeImplementation(
        state.implementation,
        planning
      );
      if (["starting", "running"].includes(implementation.status) || activeImplementationRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "Implementation agents are already running."
        );
      }
      if (implementation.status === "completed") {
        throw new AnswerRequestError(
          409,
          "Implementation is already complete."
        );
      }
      const startedAt = (/* @__PURE__ */ new Date()).toISOString();
      const retrying = implementation.workItems.some(
        (item) => item.status === "completed" || ["failed", "blocked", "cancelled"].includes(item.status)
      );
      const nextImplementation = normalizeImplementation(
        {
          ...implementation,
          status: "starting",
          runId: null,
          currentWaveIndex: 0,
          workItems: implementation.workItems.map(
            (item) => item.status === "completed" ? item : {
              ...item,
              status: "pending",
              agentId: "",
              summary: "",
              filesChanged: [],
              validation: [],
              blockers: [],
              startedAt: null,
              completedAt: null
            }
          ),
          agents: implementation.agents.filter(
            (agent) => implementation.workItems.find(
              (item) => item.id === agent.workItemId
            )?.status === "completed"
          ),
          startedAt,
          completedAt: null,
          finalizedArtifactId: null,
          error: "",
          events: [
            ...implementation.events,
            implementationEvent(
              "start",
              retrying ? "Retrying incomplete implementation work." : "Implementation run requested."
            )
          ]
        },
        planning
      );
      const next = {
        ...state,
        artifacts: markFinalCodeStale(state.artifacts),
        implementation: nextImplementation,
        status: retrying ? "Retrying incomplete implementation work..." : "Starting implementation agents...",
        updatedAt: startedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startImplementationFactory(entry.prototypeId, pending);
}
async function submitImplementationStrategy(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const text = String(body.text || "").trim().slice(0, 4e3);
  if (!text) {
    sendJson(res, 400, {
      error: "Describe the execution strategy adjustment."
    });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to adjust implementation."
    });
    return;
  }
  try {
    const state = await withAnswerClaim(entry.prototypeId, async () => {
      const current = await loadState(entry.prototypeId);
      const planning = normalizePlanning(current.planning);
      const implementation = normalizeImplementation(
        current.implementation,
        planning
      );
      if (current.lifecycle.currentStage !== "implement") {
        throw new AnswerRequestError(
          409,
          "Strategy adjustments are available only during Implement."
        );
      }
      if (implementation.status === "completed") {
        throw new AnswerRequestError(
          409,
          "Implementation is already complete."
        );
      }
      if (implementation.status === "running") {
        const hasFutureWave = planning.waves.some(
          (wave) => wave.index > implementation.currentWaveIndex && wave.workItemIds.some(
            (id) => implementation.workItems.find(
              (item) => item.id === id
            )?.status !== "completed"
          )
        );
        if (!hasFutureWave) {
          throw new AnswerRequestError(
            409,
            "No later wave is available for a safe adjustment. Stop the run and retry incomplete work to apply new guidance."
          );
        }
      }
      const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
      const next = {
        ...current,
        implementation: normalizeImplementation(
          {
            ...implementation,
            strategySuggestions: [
              ...implementation.strategySuggestions,
              {
                id: randomUUID(),
                text,
                status: "queued",
                submittedAt,
                appliedAt: null,
                waveIndex: null
              }
            ],
            events: [
              ...implementation.events,
              implementationEvent(
                "strategy",
                "A strategy adjustment was queued for the next wave."
              )
            ]
          },
          planning
        ),
        status: implementation.status === "running" ? "Strategy adjustment queued for the next wave." : "Strategy adjustment saved for the next implementation run.",
        updatedAt: submittedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
    sendJson(res, 200, publicState(entry, state));
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
}
async function submitImplementationStop(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to stop implementation."
    });
    return;
  }
  let runId = null;
  try {
    await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      const planning = normalizePlanning(state.planning);
      const implementation = normalizeImplementation(
        state.implementation,
        planning
      );
      if (!["starting", "running"].includes(implementation.status)) {
        throw new AnswerRequestError(
          409,
          "No implementation run is active."
        );
      }
      runId = implementation.runId;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const next = {
        ...state,
        implementation: normalizeImplementation(
          {
            ...implementation,
            status: "cancelled",
            completedAt: now,
            workItems: implementation.workItems.map(
              (item) => item.status === "running" ? { ...item, status: "cancelled", completedAt: now } : item
            ),
            events: [
              ...implementation.events,
              implementationEvent(
                "cancel",
                "Stop requested for the active implementation run."
              )
            ]
          },
          planning
        ),
        status: "Implementation stopped.",
        updatedAt: now
      };
      await persistState(next);
      publishState(entry.prototypeId);
    });
    if (runId) await session.factory.cancel(runId);
    sendJson(res, 202, { accepted: true });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
}
async function implementationRuntimeState(entry) {
  const state = await loadState(entry.prototypeId);
  const payload = publicState(entry, state);
  const runId = state.implementation.runId;
  if (!runId) return { ...payload, implementationRuntime: null };
  try {
    const detail = await session.factory.getRunDetail(runId);
    return {
      ...payload,
      implementationRuntime: {
        runId: detail.runId,
        status: detail.status,
        currentPhase: detail.currentPhase?.id || null,
        liveAgentCount: detail.liveAgentCount,
        totalSpawnedAgentCount: detail.totalSpawnedAgentCount,
        consumed: detail.consumed,
        agents: detail.agents.filter((agent) => agent.label.startsWith("work:")).map((agent) => ({
          id: agent.agentId,
          label: agent.label,
          status: agent.status,
          model: agent.resolvedModel || agent.requestedModel || "",
          activity: agent.activity || "",
          activeMs: agent.activeMs,
          startedAt: agent.startedAt || null,
          completedAt: agent.completedAt || null
        })),
        progress: detail.progress.records.slice(-50).map((record) => ({
          seq: record.seq,
          text: record.text,
          kind: record.kind,
          recordedAt: record.recordedAt
        }))
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Factory observability is unavailable.";
    await logSafely(
      `Tandem could not read implementation runtime details: ${message}`,
      "warning"
    );
    return {
      ...payload,
      implementationRuntime: {
        runId,
        status: "unavailable",
        currentPhase: null,
        liveAgentCount: 0,
        totalSpawnedAgentCount: 0,
        consumed: null,
        agents: [],
        progress: [],
        error: message
      }
    };
  }
}
async function submitTestStart(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to run tests."
    });
    return;
  }
  let pending;
  try {
    pending = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "test") {
        throw new AnswerRequestError(
          409,
          "Integration and interaction tests run only during Test."
        );
      }
      const review = normalizeDesignReview(state.testDesignReview);
      if (review.finalizedArtifactId !== "test-spec" || review.scenarios.length === 0) {
        throw new AnswerRequestError(
          409,
          "Finalize Test design before running tests."
        );
      }
      const testing = normalizeTesting(state.testing, review);
      if (["starting", "running"].includes(testing.status) || activeTestRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(409, "Tests are already running.");
      }
      if (testing.status === "completed") {
        throw new AnswerRequestError(409, "All tests already passed.");
      }
      const startedAt = (/* @__PURE__ */ new Date()).toISOString();
      const next = {
        ...state,
        artifacts: markTestResultsStale(state.artifacts),
        testing: normalizeTesting(
          {
            ...testing,
            status: "starting",
            runId: null,
            currentWaveIndex: 0,
            scenarios: testing.scenarios.map(
              (scenario) => scenario.status === "passed" ? scenario : {
                ...scenario,
                status: "pending",
                summary: "",
                evidence: [],
                startedAt: null,
                completedAt: null
              }
            ),
            agents: testing.agents.filter(
              (agent) => testing.scenarios.find(
                (scenario) => scenario.id === agent.scenarioId
              )?.status === "passed"
            ),
            events: [
              ...testing.events,
              testEvent("start", "Test execution requested.")
            ],
            startedAt,
            completedAt: null,
            finalizedArtifactId: null,
            error: ""
          },
          review
        ),
        status: "Starting integration and interaction tests...",
        updatedAt: startedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startTestFactory(entry.prototypeId, pending);
}
async function testRuntimeState(entry) {
  const state = await loadState(entry.prototypeId);
  const payload = publicState(entry, state);
  const runId = state.testing.runId;
  if (!runId) return { ...payload, testRuntime: null };
  try {
    const detail = await session.factory.getRunDetail(runId);
    return {
      ...payload,
      testRuntime: {
        runId,
        status: detail.status,
        currentPhase: detail.currentPhase?.id || null,
        liveAgentCount: detail.liveAgentCount,
        consumed: detail.consumed,
        agents: detail.agents.filter((agent) => agent.label.startsWith("test:")).map((agent) => ({
          label: agent.label,
          status: agent.status,
          model: agent.resolvedModel || agent.requestedModel || "",
          activity: agent.activity || "",
          activeMs: agent.activeMs
        })),
        progress: detail.progress.records.slice(-50).map((record) => ({
          seq: record.seq,
          text: record.text,
          kind: record.kind,
          recordedAt: record.recordedAt
        }))
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Test observability is unavailable.";
    await logSafely(
      `Tandem could not read test runtime details: ${message}`,
      "warning"
    );
    return {
      ...payload,
      testRuntime: {
        runId,
        status: "unavailable",
        liveAgentCount: 0,
        consumed: null,
        agents: [],
        progress: [],
        error: message
      }
    };
  }
}
async function handleRequest(entry, req, res) {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && requestUrl.pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(renderTandemHtml());
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/state") {
    await refreshEntryAnswerCapability(entry);
    sendJson(
      res,
      200,
      publicState(entry, await loadState(entry.prototypeId))
    );
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/implementation/status") {
    await refreshEntryAnswerCapability(entry);
    sendJson(res, 200, await implementationRuntimeState(entry));
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/test/status") {
    await refreshEntryAnswerCapability(entry);
    sendJson(res, 200, await testRuntimeState(entry));
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/events") {
    await refreshEntryAnswerCapability(entry);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    entry.clients.add(res);
    const state = await loadState(entry.prototypeId);
    res.write(`data: ${JSON.stringify(publicState(entry, state))}

`);
    req.on("close", () => entry.clients.delete(res));
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/answer") {
    await submitAnswer(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/revision") {
    await submitPrototypeRevision(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/design-review") {
    await submitDesignReviewRequest(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/design-review/thread") {
    await submitDesignThreadAction(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/design-review/finalize") {
    await submitDesignReviewFinalization(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/plan/generate") {
    await submitPlanningRequest(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/plan/finalize") {
    await submitPlanningFinalization(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/implementation/start") {
    await submitImplementationStart(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/implementation/strategy") {
    await submitImplementationStrategy(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/implementation/stop") {
    await submitImplementationStop(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/test/start") {
    await submitTestStart(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/reload") {
    await submitReload(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/stage/complete") {
    await submitStageCompletion(entry, req, res);
    return;
  }
  sendJson(res, 404, { error: "Not found." });
}
async function startServer(instanceId, prototypeId, extensionId, canSubmitAnswers) {
  const entry = {
    instanceId,
    prototypeId,
    extensionId,
    canSubmitAnswers,
    clients: /* @__PURE__ */ new Set(),
    server: null,
    heartbeat: null,
    url: ""
  };
  const server = createServer((req, res) => {
    handleRequest(entry, req, res).catch(async (error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Tandem request failed." });
      } else {
        res.end();
      }
      await logSafely(
        `Tandem request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  });
  await new Promise((resolve2, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve2());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  entry.server = server;
  entry.url = `http://127.0.0.1:${port}/`;
  entry.heartbeat = setInterval(() => {
    for (const client of entry.clients) client.write(": keepalive\n\n");
  }, 2e4);
  return entry;
}
var questionSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1 },
        text: { type: "string", minLength: 1 },
        rationale: { type: "string" },
        choices: {
          type: "array",
          maxItems: 6,
          items: { type: "string", minLength: 1 }
        },
        recommended: { type: ["string", "null"] },
        allowFreeText: { type: "boolean" },
        answerPlaceholder: { type: "string" }
      },
      required: ["id", "text"]
    }
  ]
};
var decisionNodeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    dependencies: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    },
    question: questionSchema,
    answer: { type: ["string", "null"] },
    status: {
      type: "string",
      enum: ["answered", "active", "toAnswer"]
    }
  },
  required: ["id", "title", "dependencies", "question", "answer"]
};
var decisionGraphSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      maxItems: 50,
      items: decisionNodeSchema
    }
  },
  required: ["nodes"]
};
var requirementsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    substage: {
      type: "string",
      enum: ["usage", "dag"]
    },
    usageItems: {
      type: "array",
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    },
    suggestions: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1 }
    }
  },
  required: ["substage", "usageItems", "suggestions"]
};
var revisionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    suggestion: { type: "string", minLength: 1 },
    status: {
      type: "string",
      enum: ["processing", "clarifying", "applied", "failed"]
    },
    summary: { type: "string" },
    clarifications: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string", minLength: 1 },
          answer: { type: "string", minLength: 1 }
        },
        required: ["question", "answer"]
      }
    },
    submittedAt: { type: "string" },
    completedAt: { type: ["string", "null"] }
  },
  required: [
    "id",
    "suggestion",
    "status",
    "summary",
    "clarifications",
    "submittedAt",
    "completedAt"
  ]
};
var evidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    content: { type: "string", minLength: 1 },
    recordedAt: { type: "string" }
  },
  required: ["id", "type", "content", "recordedAt"]
};
var prototypeReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    revisions: {
      type: "array",
      maxItems: 50,
      items: revisionSchema
    },
    activeRevisionId: { type: ["string", "null"] },
    question: questionSchema,
    evidence: {
      type: "array",
      maxItems: 100,
      items: evidenceSchema
    },
    designSpecArtifactId: { type: ["string", "null"] }
  },
  required: [
    "revisions",
    "activeRevisionId",
    "question",
    "evidence",
    "designSpecArtifactId"
  ]
};
var designReviewThreadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["question", "artifact"] },
    artifactKind: {
      type: ["string", "null"],
      enum: [
        "diagram",
        "contract",
        "decision-record",
        "test-scenario",
        null
      ]
    },
    prompt: { type: "string", minLength: 1 },
    answer: { type: "string" },
    status: {
      type: "string",
      enum: ["queued", "processing", "answered", "resolved", "failed"]
    },
    artifactIds: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    },
    reviewArtifactId: { type: ["string", "null"] },
    createdAt: { type: "string" },
    completedAt: { type: ["string", "null"] },
    error: { type: "string" }
  },
  required: [
    "id",
    "type",
    "artifactKind",
    "prompt",
    "answer",
    "status",
    "artifactIds",
    "createdAt",
    "completedAt",
    "error"
  ]
};
var testScenarioSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["integration", "interaction"] },
    description: { type: "string", minLength: 1 },
    dependencies: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    },
    expectedOutcome: { type: "string", minLength: 1 },
    validation: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    }
  },
  required: [
    "id",
    "title",
    "type",
    "description",
    "dependencies",
    "steps",
    "expectedOutcome",
    "validation"
  ]
};
var designReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    threads: {
      type: "array",
      maxItems: 100,
      items: designReviewThreadSchema
    },
    processing: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1 },
            action: {
              type: "string",
              enum: ["process-thread", "finalize"]
            },
            threadId: { type: ["string", "null"] },
            runId: { type: ["string", "null"] },
            requestedAt: { type: "string" }
          },
          required: [
            "requestId",
            "action",
            "threadId",
            "runId",
            "requestedAt"
          ]
        }
      ]
    },
    finalizeRequested: { type: "boolean" },
    finalizedArtifactId: { type: ["string", "null"] },
    scenarios: {
      type: "array",
      maxItems: 30,
      items: testScenarioSchema
    }
  },
  required: [
    "threads",
    "processing",
    "finalizeRequested",
    "finalizedArtifactId"
  ]
};
var planWorkItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    dependencies: {
      type: "array",
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    },
    agentRole: { type: "string", minLength: 1 },
    agentId: { type: "string" },
    estimatedHours: { type: "number", minimum: 0.5, maximum: 80 },
    files: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    },
    skills: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    },
    acceptanceCriteria: {
      type: "array",
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    },
    validation: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    }
  },
  required: [
    "id",
    "title",
    "description",
    "dependencies",
    "agentRole",
    "estimatedHours",
    "files",
    "skills",
    "acceptanceCriteria",
    "validation"
  ]
};
var planningSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["idle", "generating", "revising", "ready", "complete", "failed"]
    },
    summary: { type: "string" },
    strategy: { type: "string" },
    maxAgents: { type: "integer", minimum: 1, maximum: 30 },
    workItems: {
      type: "array",
      maxItems: 30,
      items: planWorkItemSchema
    },
    waves: { type: "array" },
    agents: { type: "array" },
    risks: {
      type: "array",
      maxItems: 50,
      items: { type: "string" }
    },
    revisionHistory: {
      type: "array",
      maxItems: 30,
      items: { type: "string" }
    },
    metrics: { type: "object" },
    processing: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1 },
            action: {
              type: "string",
              enum: ["generate", "revise"]
            },
            instruction: { type: "string" },
            runId: { type: ["string", "null"] },
            requestedAt: { type: "string" }
          },
          required: [
            "requestId",
            "action",
            "instruction",
            "runId",
            "requestedAt"
          ]
        }
      ]
    },
    finalizedArtifactId: { type: ["string", "null"] },
    error: { type: "string" }
  },
  required: [
    "status",
    "summary",
    "strategy",
    "maxAgents",
    "workItems",
    "waves",
    "agents",
    "risks",
    "revisionHistory",
    "metrics",
    "processing",
    "finalizedArtifactId",
    "error"
  ]
};
var planningFactoryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1 },
    strategy: { type: "string", minLength: 1 },
    workItems: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: planWorkItemSchema
    },
    risks: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    }
  },
  required: ["summary", "strategy", "workItems", "risks"]
};
var implementationAgentOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["completed", "failed"] },
    summary: { type: "string", minLength: 1 },
    filesChanged: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1 }
    },
    validation: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    },
    blockers: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    }
  },
  required: [
    "status",
    "summary",
    "filesChanged",
    "validation",
    "blockers"
  ]
};
var testAgentOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["passed", "failed"] },
    summary: { type: "string", minLength: 1 },
    evidence: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    }
  },
  required: ["status", "summary", "evidence"]
};
var artifactSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    kind: { type: "string" },
    stage: {
      type: "string",
      enum: [
        "requirements",
        "prototype",
        "design",
        "plan",
        "implement",
        "test"
      ]
    },
    path: { type: "string" },
    language: { type: "string" },
    content: { type: "string" },
    mermaid: { type: "string" },
    sourceThreadIds: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    },
    reviewStatus: {
      type: "string",
      enum: ["current", "stale"]
    }
  },
  required: ["id", "title", "content"]
};
var answerFactoryArtifactSchema = {
  ...artifactSchema,
  required: [
    "id",
    "title",
    "kind",
    "stage",
    "path",
    "language",
    "content",
    "mermaid"
  ]
};
var designReviewArtifactSchema = {
  ...artifactSchema,
  required: [
    "id",
    "title",
    "kind",
    "stage",
    "path",
    "language",
    "content",
    "mermaid",
    "sourceThreadIds",
    "reviewStatus"
  ]
};
var designReviewFactoryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string", minLength: 1 },
    artifacts: {
      type: "array",
      maxItems: 5,
      items: designReviewArtifactSchema
    },
    testScenarios: {
      type: "array",
      maxItems: 30,
      items: testScenarioSchema
    }
  },
  required: ["answer", "artifacts", "testScenarios"]
};
var answerFactoryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goal: { type: "string" },
    phase: {
      type: "string",
      enum: ["discovery", "building", "iterating", "complete"]
    },
    status: { type: "string" },
    requirements: requirementsSchema,
    prototypeReview: prototypeReviewSchema,
    question: questionSchema,
    decisionGraph: decisionGraphSchema,
    confirmed: {
      type: "array",
      items: { type: "string" }
    },
    assumed: {
      type: "array",
      items: { type: "string" }
    },
    deferred: {
      type: "array",
      items: { type: "string" }
    },
    artifactChanges: {
      type: "object",
      properties: {
        upsert: {
          type: "array",
          items: answerFactoryArtifactSchema
        },
        remove: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["upsert", "remove"]
    },
    previewUrl: {
      type: ["string", "null"]
    },
    previewStatus: {
      type: "string",
      enum: ["waiting", "starting", "ready", "error"]
    }
  },
  required: [
    "goal",
    "phase",
    "status",
    "requirements",
    "prototypeReview",
    "question",
    "decisionGraph",
    "confirmed",
    "assumed",
    "deferred",
    "artifactChanges",
    "previewUrl",
    "previewStatus"
  ]
};
var usageSuggestionFactory = defineFactory({
  meta: {
    name: SUGGESTION_FACTORY_NAME,
    description: "Generate complementary one-sentence usage suggestions without blocking usage entry.",
    phases: [
      {
        title: "Generate suggestions",
        detail: "Find useful app usages not already captured."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string" },
        requestId: { type: "string" },
        goal: { type: "string" },
        usageItems: {
          type: "array",
          maxItems: 30,
          items: { type: "string", minLength: 1 }
        }
      },
      required: ["prototypeId", "requestId", "goal", "usageItems"]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 1,
      timeoutSeconds: 120,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !String(args.prototypeId || "").trim() || !String(args.requestId || "").trim() || !Array.isArray(args.usageItems)) {
      throw new Error("Usage suggestion factory arguments are invalid.");
    }
    ctx.phase("Generate suggestions");
    ctx.log(`Request ${args.requestId}; prototype ${args.prototypeId}.`);
    return ctx.agent(
      [
        "Generate 3 to 5 concise suggestions for ways the user could use this app.",
        "Each suggestion must be one standalone sentence written",
        "in the first person, actionable, and suitable for a one-click add button.",
        "Do not repeat, paraphrase, combine, or contradict an existing usage.",
        "When no usages exist yet, provide diverse starter suggestions grounded in",
        "the app goal. If the goal is empty, provide broadly useful starter usages",
        "that help the user describe the product they want.",
        "Return only the structured output required by the schema.",
        "",
        `App goal: ${String(args.goal || "").trim()}`,
        "Existing usages:",
        ...args.usageItems.length > 0 ? args.usageItems.map((item) => `- ${item}`) : ["- None yet"]
      ].join("\n"),
      {
        label: "Generate usage suggestions",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            suggestions: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: { type: "string", minLength: 1 }
            }
          },
          required: ["suggestions"]
        },
        reasoningEffort: "low"
      }
    );
  }
});
var designReviewFactory = defineFactory({
  meta: {
    name: DESIGN_REVIEW_FACTORY_NAME,
    description: "Answer one queued Design Review request or synthesize its final review artifact.",
    phases: [
      {
        title: "Review design",
        detail: "Answer the question and produce any requested design artifacts."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string" },
        projectRoot: { type: "string" },
        requestId: { type: "string" },
        action: {
          type: "string",
          enum: ["process-thread", "finalize"]
        },
        reviewKind: {
          type: "string",
          enum: ["product", "test"]
        },
        thread: {
          anyOf: [{ type: "null" }, designReviewThreadSchema]
        },
        state: { type: "object" }
      },
      required: [
        "prototypeId",
        "projectRoot",
        "requestId",
        "action",
        "reviewKind",
        "thread",
        "state"
      ]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 30,
      timeoutSeconds: 300,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !isObject(args.state) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !String(args.requestId || "").trim() || !["product", "test"].includes(args.reviewKind) || !["process-thread", "finalize"].includes(args.action) || args.action === "process-thread" && !isObject(args.thread)) {
      throw new Error("Design Review factory arguments are invalid.");
    }
    ctx.phase("Review design");
    ctx.log(`Request ${args.requestId}; prototype ${args.prototypeId}.`);
    return ctx.agent(designReviewFactoryPrompt(args), {
      label: args.action === "finalize" ? `Finalize ${args.reviewKind} design` : `Process ${args.reviewKind} design request`,
      schema: designReviewFactoryOutputSchema,
      reasoningEffort: "high"
    });
  }
});
var planningFactory = defineFactory({
  meta: {
    name: PLANNING_FACTORY_NAME,
    description: "Generate or revise a dependency-aware implementation plan optimized for safe parallel execution.",
    phases: [
      {
        title: "Design execution plan",
        detail: "Divide implementation into parallel work items and agent roles."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string" },
        projectRoot: { type: "string" },
        requestId: { type: "string" },
        action: { type: "string", enum: ["generate", "revise"] },
        instruction: { type: "string" },
        maxAgents: { type: "integer", minimum: 1, maximum: 30 },
        state: { type: "object" }
      },
      required: [
        "prototypeId",
        "projectRoot",
        "requestId",
        "action",
        "instruction",
        "maxAgents",
        "state"
      ]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 30,
      timeoutSeconds: 600,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !isObject(args.state) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !String(args.requestId || "").trim() || !["generate", "revise"].includes(args.action) || !Number.isInteger(args.maxAgents)) {
      throw new Error("Execution-planning factory arguments are invalid.");
    }
    ctx.phase("Design execution plan");
    ctx.log(`Request ${args.requestId}; prototype ${args.prototypeId}.`);
    return ctx.agent(planningFactoryPrompt(args), {
      label: args.action === "revise" ? "Revise execution plan" : "Generate execution plan",
      schema: planningFactoryOutputSchema,
      reasoningEffort: "high"
    });
  }
});
var implementationFactory = defineFactory({
  meta: {
    name: IMPLEMENTATION_FACTORY_NAME,
    description: "Execute a finalized implementation plan in dependency waves with live agent observability.",
    phases: [
      {
        title: "Execute work items",
        detail: "Run dependency-ready work items concurrently in the active workspace."
      },
      {
        title: "Summarize implementation",
        detail: "Reconcile work-item outcomes and publish the final result."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string", minLength: 1 },
        projectRoot: { type: "string", minLength: 1 },
        plan: { type: "object" }
      },
      required: ["prototypeId", "projectRoot", "plan"]
    },
    limits: {
      maxConcurrentSubagents: 30,
      maxTotalSubagents: 30,
      timeoutSeconds: 3600,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !isObject(args.plan) || !Array.isArray(args.plan.workItems) || !Array.isArray(args.plan.waves)) {
      throw new Error("Implementation factory arguments are invalid.");
    }
    ctx.phase("Execute work items");
    ctx.log(
      `Starting ${args.plan.workItems.length} planned work items for ${args.prototypeId}.`
    );
    for (const wave of args.plan.waves) {
      const boundary = await prepareImplementationWave(
        args.prototypeId,
        wave.index,
        wave.workItemIds
      );
      if (boundary.stopped) {
        return {
          status: "failed",
          summary: "Implementation was stopped before the next wave."
        };
      }
      if (boundary.runnable.length === 0) continue;
      ctx.log(
        `Wave ${wave.index}: launching ${boundary.runnable.length} agent${boundary.runnable.length === 1 ? "" : "s"}.`
      );
      const results = [];
      for (let offset = 0; offset < boundary.runnable.length; offset += boundary.maxConcurrency) {
        const batch = boundary.runnable.slice(
          offset,
          offset + boundary.maxConcurrency
        );
        const batchNumber = Math.floor(offset / boundary.maxConcurrency) + 1;
        const batchResults = await ctx.step(
          `wave-${wave.index}-batch-${batchNumber}`,
          () => ctx.parallel(
            batch.map(
              (item) => () => ctx.agent(
                implementationPrompt(
                  args,
                  item,
                  boundary.strategy,
                  boundary.completedHandoffs
                ),
                {
                  label: `work:${item.id}`,
                  schema: implementationAgentOutputSchema,
                  reasoningEffort: "high"
                }
              )
            )
          )
        );
        results.push(
          ...Array.isArray(batchResults) ? batchResults : []
        );
      }
      await recordImplementationWaveResults(
        args.prototypeId,
        wave.index,
        boundary.runnable,
        Array.isArray(results) ? results : []
      );
    }
    ctx.phase("Summarize implementation");
    const finalState = await loadState(args.prototypeId);
    const implementation = normalizeImplementation(
      finalState.implementation,
      normalizePlanning(finalState.planning)
    );
    const failed = implementation.workItems.filter(
      (item) => ["failed", "blocked", "cancelled"].includes(item.status)
    );
    const incomplete = implementation.workItems.filter(
      (item) => item.status !== "completed"
    );
    if (incomplete.length > 0) {
      ctx.log(
        `${incomplete.length} work item${incomplete.length === 1 ? "" : "s"} remain incomplete.`
      );
      return {
        status: "failed",
        summary: failed.length > 0 ? `${failed.length} work item${failed.length === 1 ? "" : "s"} failed or were blocked.` : `${incomplete.length} work item${incomplete.length === 1 ? "" : "s"} remain incomplete.`
      };
    }
    ctx.log("All planned work items completed.");
    return {
      status: "completed",
      summary: `Completed all ${implementation.workItems.length} planned work items.`
    };
  }
});
var testFactory = defineFactory({
  meta: {
    name: TEST_FACTORY_NAME,
    description: "Execute the finalized integration and interaction test specification in dependency waves.",
    phases: [
      {
        title: "Run test scenarios",
        detail: "Exercise integration boundaries and user interactions."
      },
      {
        title: "Summarize test evidence",
        detail: "Reconcile scenario results and publish test evidence."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string", minLength: 1 },
        projectRoot: { type: "string", minLength: 1 },
        scenarios: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: testScenarioSchema
        }
      },
      required: ["prototypeId", "projectRoot", "scenarios"]
    },
    limits: {
      maxConcurrentSubagents: 4,
      maxTotalSubagents: 30,
      timeoutSeconds: 3600,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !Array.isArray(args.scenarios) || args.scenarios.length === 0) {
      throw new Error("Test factory arguments are invalid.");
    }
    const scenarios = normalizeTestScenarios(args.scenarios);
    const schedule = scheduleTestScenarios(scenarios, 4);
    if (schedule.error || schedule.waves.length === 0) {
      throw new Error(schedule.error || "No test scenarios could be scheduled.");
    }
    ctx.phase("Run test scenarios");
    for (const wave of schedule.waves) {
      const runnable = await prepareTestWave(args.prototypeId, wave);
      if (runnable.length === 0) continue;
      const current = await loadState(args.prototypeId);
      const dependencyEvidence = normalizeTesting(
        current.testing,
        normalizeDesignReview(current.testDesignReview)
      ).scenarios.filter(
        (scenario) => scenario.status === "passed" && runnable.some(
          (candidate) => candidate.dependencies.includes(scenario.id)
        )
      ).map(
        (scenario) => `${scenario.id}: ${scenario.summary || "passed"}`
      );
      const results = await ctx.step(
        `test-wave-${wave.index}`,
        () => ctx.parallel(
          runnable.map(
            (scenario) => () => ctx.agent(
              testScenarioPrompt(
                args,
                scenario,
                dependencyEvidence
              ),
              {
                label: `test:${scenario.id}`,
                schema: testAgentOutputSchema,
                reasoningEffort: "high"
              }
            )
          )
        )
      );
      await recordTestWaveResults(
        args.prototypeId,
        wave,
        runnable,
        Array.isArray(results) ? results : []
      );
    }
    ctx.phase("Summarize test evidence");
    const finalState = await loadState(args.prototypeId);
    const testing = normalizeTesting(
      finalState.testing,
      normalizeDesignReview(finalState.testDesignReview)
    );
    const passed = testing.scenarios.length > 0 && testing.scenarios.every((scenario) => scenario.status === "passed");
    return {
      status: passed ? "passed" : "failed",
      summary: passed ? `All ${testing.scenarios.length} integration and interaction scenarios passed.` : `${testing.scenarios.filter(
        (scenario) => scenario.status !== "passed"
      ).length} test scenarios failed or were blocked.`
    };
  }
});
var answerFactory = defineFactory({
  meta: {
    name: ANSWER_FACTORY_NAME,
    description: "Process one Tandem answer in a hidden agent and return the complete next Tandem state.",
    phases: [
      {
        title: "Interpret decision",
        detail: "Apply the selected product intent to the current prototype."
      },
      {
        title: "Return Tandem update",
        detail: "Synthesize the next ledger, artifacts, and question."
      }
    ],
    argsSchema: {
      type: "object",
      properties: {
        prototypeId: { type: "string" },
        projectRoot: { type: "string" },
        requestId: { type: "string" },
        question: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" }
          },
          required: ["id", "text"]
        },
        answer: { type: "string" },
        action: {
          type: "string",
          enum: [
            "add-usage",
            "generate-dag",
            "answer-decision",
            "change-answer",
            "submit-revision",
            "clarify-revision",
            "generate-design-spec"
          ]
        },
        state: { type: "object" }
      },
      required: [
        "prototypeId",
        "projectRoot",
        "requestId",
        "question",
        "answer",
        "action",
        "state"
      ]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 30,
      timeoutSeconds: 300,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !isObject(args.question) || !isObject(args.state) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !String(args.requestId || "").trim() || !String(args.question.id || "").trim() || !String(args.question.text || "").trim() || !String(args.answer || "").trim() || !ANSWER_ACTIONS.has(args.action)) {
      throw new Error("Tandem factory arguments are invalid.");
    }
    ctx.phase("Interpret decision");
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      throw new Error(
        "This provider no longer owns hidden answer processing."
      );
    }
    ctx.log(
      `Request ${args.requestId}; prototype ${args.prototypeId}; question ${args.question.id}.`
    );
    const result = await ctx.step(
      "process-answer",
      () => ctx.agent(answerFactoryPrompt(args), {
        label: "Process Tandem answer",
        schema: answerFactoryOutputSchema,
        reasoningEffort: "medium"
      })
    );
    if (!isObject(result)) {
      throw new Error("The hidden agent returned an invalid Tandem update.");
    }
    ctx.phase("Return Tandem update");
    ctx.log("Returning the complete Tandem state.");
    return result;
  }
});
session = await joinSession({
  factories: [
    usageSuggestionFactory,
    designReviewFactory,
    planningFactory,
    implementationFactory,
    testFactory,
    answerFactory
  ],
  hooks: {
    onUserPromptSubmitted: async (input) => {
      if (!/^\/tandem(?:\s|$)/i.test(input.prompt.trim())) {
        return void 0;
      }
      return {
        additionalContext: [
          "The user supplied only the prototype goal, which is expected.",
          "Open Tandem canvas immediately and conduct",
          "requirement discovery through its update_tandem action.",
          "Do not ask the user to write a more detailed invocation prompt."
        ].join(" ")
      };
    }
  },
  canvases: [
    createCanvas({
      id: CANVAS_ID,
      displayName: "Tandem",
      description: "Capture software intent and lifecycle artifacts through staged workflows, starting with prototyping.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          prototypeId: { type: "string", minLength: 1 },
          goal: { type: "string" }
        }
      },
      actions: [
        {
          name: "update_tandem",
          description: "Update usage intake, the dynamic decision DAG, prototype review evidence, captured artifacts, workflow phase, or embedded preview.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              prototypeId: { type: "string", minLength: 1 },
              reset: { type: "boolean" },
              stage: { type: "string", minLength: 1 },
              goal: { type: "string" },
              phase: {
                type: "string",
                enum: ["discovery", "building", "iterating", "complete"]
              },
              status: { type: "string" },
              requirements: requirementsSchema,
              prototypeReview: prototypeReviewSchema,
              designReview: designReviewSchema,
              planning: planningSchema,
              question: questionSchema,
              decisionGraph: decisionGraphSchema,
              confirmed: {
                type: "array",
                items: { type: "string" }
              },
              assumed: {
                type: "array",
                items: { type: "string" }
              },
              deferred: {
                type: "array",
                items: { type: "string" }
              },
              artifacts: {
                type: "array",
                maxItems: 30,
                items: artifactSchema
              },
              previewUrl: {
                anyOf: [
                  { type: "string" },
                  { type: "null" }
                ]
              },
              previewStatus: {
                type: "string",
                enum: ["waiting", "starting", "ready", "error"]
              }
            }
          },
          handler: updateTandem
        },
        {
          name: "complete_stage",
          description: "Persist the active stage result and unlock the next stage. Prototype must be finished in Tandem so its draft feature spec is generated first.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              prototypeId: { type: "string", minLength: 1 },
              stageId: {
                type: "string",
                enum: [
                  "requirements",
                  "prototype",
                  "design",
                  "plan",
                  "implement",
                  "test"
                ]
              }
            }
          },
          handler: completeStage
        },
        {
          name: "get_tandem_state",
          description: "Read lifecycle, requirements, prototype revisions, Design Review threads, evidence, artifacts, phase, and preview state.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              prototypeId: { type: "string", minLength: 1 }
            }
          },
          handler: async (ctx) => {
            const input = isObject(ctx.input) ? ctx.input : {};
            const prototypeId = await resolvePrototypeId(
              ctx.instanceId,
              input.prototypeId
            );
            return loadState(prototypeId);
          }
        }
      ],
      open: async (ctx) => {
        const input = isObject(ctx.input) ? ctx.input : {};
        const prototypeId = await resolvePrototypeId(
          ctx.instanceId,
          input.prototypeId
        );
        instancePrototypeIds.set(ctx.instanceId, prototypeId);
        const canSubmitAnswers = await isPreferredAnswerProvider(
          ctx.extensionId
        );
        if (canSubmitAnswers) {
          await persistCurrentPrototypeId(prototypeId);
        }
        let state = await loadState(prototypeId);
        state = await markReloadComplete(state, ctx.extensionId);
        state = await ensureDefaultProductDesignReview(
          state,
          canSubmitAnswers
        );
        recoverAnswerFactory(state, canSubmitAnswers);
        recoverSuggestionFactory(state, canSubmitAnswers);
        recoverPrototypeCompletion(state, canSubmitAnswers);
        recoverDesignReviewFactory(state, canSubmitAnswers);
        recoverPlanningFactory(state, canSubmitAnswers);
        recoverImplementationFactory(state, canSubmitAnswers);
        recoverTestFactory(state, canSubmitAnswers);
        if (canSubmitAnswers && typeof input.goal === "string" && input.goal.trim() && !state.goal) {
          state = await withAnswerClaim(prototypeId, async () => {
            const current = await loadState(prototypeId);
            if (current.goal || current.processing?.status === "running") {
              return current;
            }
            const next = {
              ...current,
              goal: input.goal.trim().slice(0, 4e3),
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            };
            await persistState(next);
            publishState(prototypeId);
            return next;
          });
        }
        state = await ensureUsageSuggestionsStarted(
          state,
          canSubmitAnswers
        );
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
          entry = await startServer(
            ctx.instanceId,
            prototypeId,
            ctx.extensionId,
            canSubmitAnswers
          );
          servers.set(ctx.instanceId, entry);
        } else {
          entry.prototypeId = prototypeId;
          entry.extensionId = ctx.extensionId;
          entry.canSubmitAnswers = canSubmitAnswers;
        }
        return {
          title: "Tandem",
          status: state.status,
          url: entry.url
        };
      },
      onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) return;
        servers.delete(ctx.instanceId);
        instancePrototypeIds.delete(ctx.instanceId);
        clearInterval(entry.heartbeat);
        for (const client of entry.clients) client.end();
        await new Promise((resolve2) => entry.server.close(resolve2));
      }
    })
  ]
});
