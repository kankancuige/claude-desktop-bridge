---
name: grill-me
description: Built-in plan mode phase — automatically challenge design decisions after writing a plan. Not bug hunting, design only.
---

# Grill Me — Design Decision Review

Built-in phase of plan mode. **Enter plan → write plan → auto grill → refine → Exit plan.**

## When to Trigger

Automatically triggered, no need for user to say "grill me":

- User finishes writing a plan in plan mode, before ExitPlanMode
- Plan involves multiple files / new modules / architecture changes — must grill

Skip when:
- Single-file minor change, pure bug fix, no design decisions involved

## Review Dimensions

Challenge every design decision across 5 dimensions. **Target specific decisions, never vague criticism:**

### 1. Naming
- Is each new variable/function/file/type name precise? Any ambiguity?
- Could it be shorter or more specific?
- Does the name expose implementation details instead of intent?

### 2. Simplicity
- Is there a simpler implementation? Can we delete code instead of adding?
- What happens if we remove this line entirely?
- Any over-engineered patterns (factory-of-factories, unnecessary DI, extension points "for the future")?

### 3. Abstraction
- Is each new abstraction layer (class, interface, extracted function, module boundary) necessary?
- Is it just moving code around without reducing complexity?
- Does the abstraction leak underlying details?

### 4. Implicit Assumptions
- What hidden assumptions does each part of the plan depend on?
- (Ordering of external state, implicit timing, undeclared contracts, "this value can never be null")
- What happens if each assumption is violated?

### 5. Clarity
- Is this code friendly to the next person? Where would they get confused?
- Is the control flow obvious?
- Any "clever" code that would need a comment to understand?

## Output Format

In plan mode, after writing the plan, output all questions at once, grouped by category:

```
## Grill — Design Review

### Naming
1. **Is "xxx" ambiguous?** — specific concern
   Suggestion: ...

### Simplicity
1. **Can this middle layer be removed?** — reasoning
   ...

### Abstraction
...

### Implicit Assumptions
...

### Clarity
...

---
Pick what to address, ignore the rest. Push back if I'm wrong.
```

## Principles

- **No bug hunting** — that's code-review's job
- **No security scanning** — that's security-review's job
- **Design only** — question every abstraction, name, and indirection
- **Better to over-report** — you can ignore what doesn't matter, but I can't miss what does
- **Target specific decisions** — not "this design is bad" but "UserService handles both auth and profile — should these be split?"
- **Loop until user says stop** — grill → user refines → auto grill again (no asking, just do it). Each round only targets changed parts and newly introduced decisions. Loop continues until user signals "plan is final, start building" — "let's go", "start implementing", "OK let's code", "looks good", "ship it", "Exit plan", "done", etc. Semantic recognition, not literal matching. Do not exit plan mode until user signals stop.
