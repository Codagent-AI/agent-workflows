export interface Option { id: string; label: string; detail?: string }
export interface Question { prompt: string; options: Option[] }
export interface KeyEvidence { file: string; title: string; shows: string }
export interface LateJourney { code: string; title: string; commit: string }

export function validQuestion(question: Question): boolean {
  if (typeof question?.prompt !== 'string' || !question.prompt.trim() || !Array.isArray(question.options)) return false;
  const { options } = question;
  return options.length >= 2 && options.length <= 4 && options.every(option =>
    typeof option?.id === 'string' && Boolean(option.id.trim()) && option.id !== 'other' &&
    typeof option.label === 'string' && Boolean(option.label.trim())) &&
    new Set(options.map(option => option.id)).size === options.length;
}

export function standardQuestion(type: string): Question {
  return { prompt: type === 'Failure' ? 'How should the run handle this failure?' : 'What should the run do about this item?',
    options: [{ id: 'fix', label: 'Fix it in the next round' }, { id: 'leave', label: 'Leave it for me to handle' }] };
}

export function disputeQuestion(edit: string): Question {
  const options: Option[] = [{ id: 'follow-up', label: 'Merge without it and define a follow-up change' }, { id: 'drop', label: 'Drop the request' }];
  if (edit) options.unshift({ id: 'spec-edit', label: 'Apply this spec edit', detail: edit });
  return { prompt: 'How should the run handle this request to change approved behavior?', options };
}
