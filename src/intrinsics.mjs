import { forwardLinearize, valueAndGradient, stopGradient } from './differential.mjs';
// Closed compiler registry: source programs cannot install handlers or gain I/O.
export const intrinsicArities=Object.freeze({jvp:3,grad:2,value_and_grad:2,stop_gradient:1});
export function inferIntrinsic(name,{a,b,Num,fn}) {
  if(name==='jvp')return fn([fn([a],b),a,a],{tag:'Record',tail:null,
    fields:new Map([['value',b],['tangent',b]])});
  if(name==='grad')return fn([fn([a],Num),a],a);
  if(name==='value_and_grad')return fn([fn([a],Num),a],{tag:'Record',tail:null,
    fields:new Map([['value',Num],['gradient',a]])});
  if(name==='stop_gradient')return fn([a],a);
  return null;
}
export function stageIntrinsic(name,args,api,at) {
  if(name==='jvp')return forwardLinearize(...args,api,at);
  if(name==='grad'||name==='value_and_grad') {
    const result=valueAndGradient(...args,api,at);
    return name==='grad'?result.fields.get('gradient'):result;
  }
  if(name==='stop_gradient')return stopGradient(args[0],api,at);
  api.fail(`Unknown intrinsic '${name}'`,at,'E_NAME');
}
