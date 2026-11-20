; Symbolic bounded-cost admission sanity check, not hardware WCET certification.
; Safe claim should be UNSAT. Deliberate omitted-cleanup bug should be SAT.
(set-logic QF_LIA)
(declare-const wcet Int)
(declare-const jitter Int)
(declare-const interference Int)
(declare-const blocking Int)
(declare-const cleanup Int)
(declare-const activation Int)
(declare-const deadline Int)
(declare-const allKnown Bool)
(declare-const certMatches Bool)
(assert (and (<= 0 wcet) (<= 0 jitter) (<= 0 interference)
             (<= 0 blocking) (<= 0 cleanup) (<= 0 activation)
             (<= 0 deadline)))
(define-fun response () Int (+ wcet jitter interference blocking cleanup activation))
(define-fun SafeAdmit () Bool
  (and allKnown certMatches (<= response deadline)))
(define-fun BuggyAdmit () Bool
  (and allKnown certMatches (<= (+ wcet jitter interference blocking activation) deadline)))
(push 1)
(assert SafeAdmit)
(assert (or (not allKnown) (not certMatches) (> response deadline)))
(check-sat) ; expected UNSAT
(pop 1)
(push 1)
(assert BuggyAdmit)
(assert (> response deadline))
(check-sat) ; expected SAT: cleanup omitted
(get-model)
(pop 1)
