package a2e.abac_test

import data.a2e.abac as abac
import data.testdata.marking_cases as cases
import future.keywords.contains
import future.keywords.every
import future.keywords.if
import future.keywords.in

failures contains case.name if {
	some case in cases
	decision := abac.result with input as case_input(case)
	not check_case(case, decision)
}

test_marking_cases if {
	count(failures) == 0
}

check_case(case, decision) if {
	case.allow == true
	decision.allow == true
}

check_case(case, decision) if {
	case.allow == false
	decision.allow == false
	decision.reasons[_] == case.reason
}

test_missing_input_denies if {
	decision := abac.result with input as {}
	decision.allow == false
	decision.reasons[_] == "invalid_input"
}

test_release_recipient_noforn if {
	decision := abac.result with input as {
		"action": "release.export",
		"system_high": "CUI",
		"subject": {
			"clearance": "CUI",
			"citizenship": "USA",
			"ntk": ["isr-demo"],
			"roles": ["analyst"],
			"accessible_tenant_ids": ["t1"],
		},
		"resource": {
			"tenant_id": "t1",
			"classification": "CUI",
			"caveats": ["NOFORN"],
			"ntk": ["isr-demo"],
		},
		"recipient": {"clearance": "CUI", "citizenship": "GBR", "ntk": ["isr-demo"]},
	}
	decision.allow == false
	decision.reasons[_] == "noforn"
}

reason_present(reasons, expected) if {
	reasons[_] == expected
}

case_input(case) := {
	"action": case.action,
	"system_high": case.system_high,
	"subject": case.subject,
	"resource": case.resource,
}
