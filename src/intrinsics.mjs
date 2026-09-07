import { forwardLinearize, stopGradient } from './differential.mjs';
// Closed compiler registry: source programs cannot install handlers or gain I/O.
export const intrinsicArities=Object.freeze({jvp:3,stop_gradient:1});
export function inferIntrinsic(name,{a,b,fn}) {
  if(name==='jvp')return fn([fn([a],b),a,a],{tag:'Record',tail:null,
    fields:new Map([['value',b],['tangent',b]])});
  if(name==='stop_gradient')return fn([a],a);
  return null;
}
export function stageIntrinsic(name,args,api,at) {
  if(name==='jvp')return forwardLinearize(...args,api,at);
  if(name==='stop_gradient')return stopGradient(args[0],api,at);
  api.fail(`Unknown intrinsic '${name}'`,at,'E_NAME');
}
