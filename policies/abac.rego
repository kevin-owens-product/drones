package a2e.abac

import future.keywords.contains
import future.keywords.every
import future.keywords.if
import future.keywords.in

default result := {"allow": false, "reasons": ["invalid_input"]}

classification_rank := {
	"UNCLASSIFIED": 0,
	"CUI": 1,
	"CONFIDENTIAL": 2,
	"SECRET": 3,
	"TOP_SECRET": 4,
}

fvey := {"USA", "GBR", "CAN", "AUS", "NZL"}

result := {"allow": count(reason_set) == 0, "reasons": reason_set} if {
	input_ok
}

input_ok if {
	is_string(input.action)
	input.action != ""
	is_string(input.subject.citizenship)
	is_string(input.subject.clearance)
	is_string(input.system_high)
	classification_rank[input.system_high]
}

reason_set contains "citizenship_invalid" if {
	input_ok
	not citizenship_valid(input.subject.citizenship)
}

reason_set contains "role_denied" if {
	input_ok
	not role_ok
}

reason_set contains "tenant_denied" if {
	input_ok
	not tenant_ok
}

reason_set contains "clearance_insufficient" if {
	input_ok
	resource_present
	not clearance_ok(input.subject.clearance, input.resource.classification)
}

reason_set contains "above_system_high" if {
	input_ok
	resource_present
	above_high(input.resource.classification, input.system_high)
}

reason_set contains "caveat_not_understood" if {
	input_ok
	resource_present
	not caveats_understood(object.get(input.resource, "caveats", []))
}

reason_set contains "noforn" if {
	input_ok
	resource_present
	caveats_understood(object.get(input.resource, "caveats", []))
	not noforn_ok(object.get(input.resource, "caveats", []), input.subject.citizenship)
}

reason_set contains "rel_to_denied" if {
	input_ok
	resource_present
	caveats_understood(object.get(input.resource, "caveats", []))
	not rel_to_ok(object.get(input.resource, "caveats", []), input.subject.citizenship)
}

reason_set contains "ntk_denied" if {
	input_ok
	resource_present
	not ntk_ok(object.get(input.resource, "ntk", []), object.get(input.subject, "ntk", []))
}

reason_set contains "recipient_invalid" if {
	input_ok
	input.action == "release.export"
	not recipient_present
}

reason_set contains "clearance_insufficient" if {
	input_ok
	input.action == "release.export"
	recipient_present
	resource_present
	not clearance_ok(input.recipient.clearance, input.resource.classification)
}

reason_set contains "above_system_high" if {
	input_ok
	input.action == "release.export"
	recipient_present
	resource_present
	above_high(input.resource.classification, input.system_high)
}

reason_set contains "noforn" if {
	input_ok
	input.action == "release.export"
	recipient_present
	resource_present
	caveats_understood(object.get(input.resource, "caveats", []))
	not noforn_ok(object.get(input.resource, "caveats", []), input.recipient.citizenship)
}

reason_set contains "rel_to_denied" if {
	input_ok
	input.action == "release.export"
	recipient_present
	resource_present
	caveats_understood(object.get(input.resource, "caveats", []))
	not rel_to_ok(object.get(input.resource, "caveats", []), input.recipient.citizenship)
}

reason_set contains "ntk_denied" if {
	input_ok
	input.action == "release.export"
	recipient_present
	resource_present
	not ntk_ok(object.get(input.resource, "ntk", []), object.get(input.recipient, "ntk", []))
}

reason_set contains "citizenship_invalid" if {
	input_ok
	input.action == "release.export"
	recipient_present
	not citizenship_valid(input.recipient.citizenship)
}

resource_present if {
	is_string(input.resource.classification)
	input.resource.classification != ""
}

recipient_present if {
	is_string(input.recipient.citizenship)
	is_string(input.recipient.clearance)
}

role_ok if {
	some role in input.subject.roles
	action_in_role(role, input.action)
}

action_in_role(role, action) if {
	data.role_matrix[role][_] == action
}

tenant_ok if {
	not input.resource.tenant_id
	count(input.subject.roles) > 0
}

tenant_ok if {
	input.resource.tenant_id
	some tenant in input.subject.accessible_tenant_ids
	tenant == input.resource.tenant_id
}

citizenship_valid(value) if {
	regex.match("^[A-Z]{3}$", value)
}

clearance_ok(holder, row) if {
	classification_rank[holder] >= classification_rank[row]
}

above_high(row, high) if {
	classification_rank[row] > classification_rank[high]
}

caveats_understood(caveats) if {
	every caveat in caveats {
		caveat_known(caveat)
	}
}

caveat_known(caveat) if {
	caveat == "NOFORN"
}

caveat_known(caveat) if {
	startswith(caveat, "REL TO ")
	every token in rel_tokens(caveat) {
		token_known(token)
	}
	count(rel_tokens(caveat)) > 0
}

token_known(token) if token == "FVEY"

token_known(token) if regex.match("^[A-Z]{3}$", token)

noforn_ok(caveats, citizenship) if {
	not has_noforn(caveats)
}

noforn_ok(caveats, citizenship) if {
	has_noforn(caveats)
	citizenship == "USA"
}

has_noforn(caveats) if {
	some caveat in caveats
	caveat == "NOFORN"
}

rel_to_ok(caveats, citizenship) if {
	not has_rel(caveats)
}

rel_to_ok(caveats, citizenship) if {
	has_rel(caveats)
	some caveat in caveats
	startswith(caveat, "REL TO ")
	some token in rel_tokens(caveat)
	token_allows(token, citizenship)
}

has_rel(caveats) if {
	some caveat in caveats
	startswith(caveat, "REL TO ")
}

token_allows(token, citizenship) if token == citizenship

token_allows(token, citizenship) if {
	token == "FVEY"
	citizenship == fvey[_]
}

rel_tokens(caveat) := tokens if {
	body := substring(caveat, count("REL TO "), -1)
	tokens := [token |
		piece := split(body, ",")[_]
		token := split(piece, " ")[_]
		token != ""
	]
}

ntk_ok(row_ntk, holder_ntk) if {
	count(row_ntk) == 0
}

ntk_ok(row_ntk, holder_ntk) if {
	some program in row_ntk
	program == holder_ntk[_]
}
