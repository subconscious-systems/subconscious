package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestActionArgsPreserveProfileAndModel(t *testing.T) {
	item := menuItem{Command: "claude", Kind: itemAgent, Launch: true}
	want := []string{"-p", "staging", "claude", "--model", "subconscious/glm-5.2"}
	if got := actionArgs(item, "staging", "subconscious/glm-5.2", ""); !reflect.DeepEqual(got, want) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, want)
	}
}

func TestActionArgsDoNotSendModelToSetupAgent(t *testing.T) {
	item := menuItem{Command: "cursor", Kind: itemAgent, Launch: false}
	want := []string{"-p", "default", "cursor"}
	if got := actionArgs(item, "default", "subconscious/glm-5.2", ""); !reflect.DeepEqual(got, want) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, want)
	}
}

func TestSetDefaultModelActionPersistsThroughConfig(t *testing.T) {
	item := menuItem{Command: "config", Kind: itemSetDefaultModel}
	want := []string{"-p", "work", "config", "--model", "subconscious/deepseek"}
	if got := actionArgs(item, "work", "subconscious/deepseek", ""); !reflect.DeepEqual(got, want) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, want)
	}
}

func TestSetSubagentModelActionPersistsThroughConfig(t *testing.T) {
	item := menuItem{Command: "config", Kind: itemSetSubagentModel}
	want := []string{"-p", "work", "config", "--subagent-model", "subconscious/fast"}
	if got := actionArgs(item, "work", "subconscious/default", "subconscious/fast"); !reflect.DeepEqual(got, want) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, want)
	}

	wantFollowDefault := []string{"-p", "work", "config", "--subagent-model", "follow-default"}
	if got := actionArgs(item, "work", "subconscious/default", ""); !reflect.DeepEqual(got, wantFollowDefault) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, wantFollowDefault)
	}
}

func TestSubagentModelPickerIncludesFollowDefault(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "work",
		SelectedModel: "subconscious/default",
		SubagentModel: "subconscious/fast",
		Models:        []string{"subconscious/default", "subconscious/fast"},
	})
	if m.subagentCursor != 2 {
		t.Fatalf("subagent cursor = %d, want 2", m.subagentCursor)
	}
	options := subagentModelOptions(m.state)
	if options[0] != "Follow default model" {
		t.Fatalf("first subagent option = %q", options[0])
	}

	m.subagentCursor = 0
	next, _ := m.updateSubagentModels("enter")
	updated := next.(model)
	want := []string{"-p", "work", "config", "--subagent-model", "follow-default"}
	if !reflect.DeepEqual(updated.result.Args, want) {
		t.Fatalf("picker result = %#v, want %#v", updated.result.Args, want)
	}
}

func TestNormalizeStateKeepsConfiguredSelectionsVisible(t *testing.T) {
	state := normalizeState(inputState{
		ActiveProfile: "staging",
		SelectedModel: "subconscious/new-model",
		Profiles:      []profileState{{Name: "default"}},
		Models:        []string{"subconscious/glm-5.2"},
	})
	if state.Profiles[0].Name != "staging" {
		t.Fatalf("active profile not inserted: %#v", state.Profiles)
	}
	if state.Models[0] != "subconscious/new-model" {
		t.Fatalf("selected model not inserted: %#v", state.Models)
	}
}

func TestWrapIndex(t *testing.T) {
	if got := wrapIndex(-1, 3); got != 2 {
		t.Fatalf("wrapIndex(-1, 3) = %d, want 2", got)
	}
	if got := wrapIndex(3, 3); got != 0 {
		t.Fatalf("wrapIndex(3, 3) = %d, want 0", got)
	}
}

func TestAccountStatusLivesOnlyInHeader(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		Agents:        []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	for _, item := range m.items {
		if item.Command == "whoami" || item.Name == "Account status" {
			t.Fatalf("redundant account status menu item remains: %#v", item)
		}
	}
}

func TestAvailableModelsDetailShowsCatalogInsteadOfCommand(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		SelectedModel: "subconscious/glm-5.2",
		Models: []string{
			"subconscious/glm-5.2",
			"subconscious/deepseek-v4-flash-marathon",
		},
		Agents: []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	for index, item := range m.items {
		if item.Command == "models" {
			m.cursor = index
			break
		}
	}
	detail := m.renderDetail(56)
	if !strings.Contains(detail, "subconscious/deepseek-v4-flash-marathon") {
		t.Fatalf("model catalog missing from detail: %q", detail)
	}
	if strings.Contains(detail, "$ subc") {
		t.Fatalf("command preview should not appear in model catalog: %q", detail)
	}
}

func TestNormalizeBaseURL(t *testing.T) {
	got, err := normalizeBaseURL("https://gateway.example/v1/")
	if err != nil || got != "https://gateway.example/v1" {
		t.Fatalf("normalizeBaseURL() = %q, %v", got, err)
	}
	for _, invalid := range []string{
		"localhost:8080",
		"file:///tmp/gateway",
		"https://user:pass@gateway.example",
		"https://gateway.example?token=secret",
	} {
		if _, err := normalizeBaseURL(invalid); err == nil {
			t.Fatalf("normalizeBaseURL(%q) unexpectedly succeeded", invalid)
		}
	}
}

func TestUpdateProfileValuePreservesOtherSettings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles", "work.env")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("GATEWAY_URL=https://old.example\nMODEL=subconscious/glm-5.2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := updateProfileValue(path, "GATEWAY_URL", "https://new.example"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "GATEWAY_URL=https://new.example\n") {
		t.Fatalf("new gateway missing: %q", text)
	}
	if !strings.Contains(text, "MODEL=subconscious/glm-5.2\n") {
		t.Fatalf("other profile settings were not preserved: %q", text)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("profile mode = %o, want 600", info.Mode().Perm())
	}
}

func TestUpdateBaseURLUsesInlineDetail(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		GatewayURL:    "https://gateway.example",
		Agents:        []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	for index, item := range m.items {
		if item.Kind == itemUpdateBaseURL {
			m.cursor = index
			break
		}
	}
	detail := m.renderDetail(56)
	if !strings.Contains(detail, "https://gateway.example") || !strings.Contains(detail, "Inline editor") {
		t.Fatalf("inline gateway detail missing: %q", detail)
	}
	if strings.Contains(detail, "$ subc") {
		t.Fatalf("gateway editor should not show a command preview: %q", detail)
	}
}

func TestMenuActionsUseOneFixedColumn(t *testing.T) {
	launch := menuRowText("Claude Code", "Launch", 24, 12, false)
	configure := menuRowText("Cursor", "Configure", 24, 12, false)
	authenticate := menuRowText("Sign in", "Authenticate", 24, 12, false)
	launchColumn := strings.Index(launch, "Launch")
	if strings.Index(configure, "Configure") != launchColumn {
		t.Fatalf("Configure starts in a different column: %q vs %q", launch, configure)
	}
	if strings.Index(authenticate, "Authenticate") != launchColumn {
		t.Fatalf("Authenticate starts in a different column: %q vs %q", launch, authenticate)
	}
}

func TestCommandHelpIsNotAMenuItem(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		Agents:        []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	for _, item := range m.items {
		if item.Command == "--help" || item.Name == "Command help" {
			t.Fatalf("command help should not be a menu item: %#v", item)
		}
	}
}

func TestVersionIsVisibleInTUIHeader(t *testing.T) {
	m := newModel(inputState{
		Version:       "4.0.10",
		ActiveProfile: "default",
	})
	m.width = 100
	m.height = 40
	if header := m.renderHeader(m.width); !strings.Contains(header, "v4.0.10") {
		t.Fatalf("wide header does not show version: %q", header)
	}

	m.width = 50
	m.height = 10
	if header := m.renderHeader(m.width); !strings.Contains(header, "CLI v4.0.10") {
		t.Fatalf("compact header does not show version: %q", header)
	}
}
