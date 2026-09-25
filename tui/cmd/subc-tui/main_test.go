package main

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

func TestActionArgsPreserveProfileAndModel(t *testing.T) {
	item := menuItem{Command: "claude", Kind: itemAgent, Launch: true}
	want := []string{"-p", "staging", "claude", "--model", "subconscious/glm-5.3-marathon"}
	if got := actionArgs(item, "staging", "subconscious/glm-5.3-marathon", ""); !reflect.DeepEqual(got, want) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, want)
	}
}

func TestActionArgsDoNotSendModelToSetupAgent(t *testing.T) {
	item := menuItem{Command: "cursor", Kind: itemAgent, Launch: false}
	want := []string{"-p", "default", "cursor"}
	if got := actionArgs(item, "default", "subconscious/glm-5.3-marathon", ""); !reflect.DeepEqual(got, want) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, want)
	}
}

func TestDefaultModelPickerIncludesUnset(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "work",
		SelectedModel: "",
		Models:        []string{"subconscious/default", "subconscious/fast"},
	})
	if m.modelCursor != 0 {
		t.Fatalf("model cursor = %d, want 0", m.modelCursor)
	}
	options := defaultModelOptions(m.state)
	if options[0] != "UNSET" {
		t.Fatalf("first model option = %q", options[0])
	}

	next, _ := m.updateModels("enter")
	updated := next.(model)
	want := []string{"-p", "work", "config", "--model", "UNSET"}
	if !reflect.DeepEqual(updated.result.Args, want) {
		t.Fatalf("picker result = %#v, want %#v", updated.result.Args, want)
	}
}

func TestSetDefaultModelActionPersistsThroughConfig(t *testing.T) {
	item := menuItem{Command: "config", Kind: itemSetDefaultModel}
	want := []string{"-p", "work", "config", "--model", "subconscious/deepseek"}
	if got := actionArgs(item, "work", "subconscious/deepseek", ""); !reflect.DeepEqual(got, want) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, want)
	}

	wantUnset := []string{"-p", "work", "config", "--model", "UNSET"}
	if got := actionArgs(item, "work", "", ""); !reflect.DeepEqual(got, wantUnset) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, wantUnset)
	}
}

func TestSetSubagentModelActionPersistsThroughConfig(t *testing.T) {
	item := menuItem{Command: "config", Kind: itemSetSubagentModel}
	want := []string{"-p", "work", "config", "--subagent-model", "subconscious/fast"}
	if got := actionArgs(item, "work", "subconscious/default", "subconscious/fast"); !reflect.DeepEqual(got, want) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, want)
	}

	wantUnset := []string{"-p", "work", "config", "--subagent-model", "UNSET"}
	if got := actionArgs(item, "work", "subconscious/default", ""); !reflect.DeepEqual(got, wantUnset) {
		t.Fatalf("actionArgs() = %#v, want %#v", got, wantUnset)
	}
}

func TestSubagentModelPickerIncludesUnset(t *testing.T) {
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
	if options[0] != "UNSET" {
		t.Fatalf("first subagent option = %q", options[0])
	}

	m.subagentCursor = 0
	next, _ := m.updateSubagentModels("enter")
	updated := next.(model)
	want := []string{"-p", "work", "config", "--subagent-model", "UNSET"}
	if !reflect.DeepEqual(updated.result.Args, want) {
		t.Fatalf("picker result = %#v, want %#v", updated.result.Args, want)
	}
}

func TestNormalizeStateKeepsUnsetDefaultModel(t *testing.T) {
	state := normalizeState(inputState{
		ActiveProfile: "staging",
		SelectedModel: "",
		Models:        []string{"subconscious/glm-5.3"},
	})
	if state.SelectedModel != "" {
		t.Fatalf("unset model was filled: %#v", state.SelectedModel)
	}
}

func TestNormalizeStateKeepsConfiguredSelectionsVisible(t *testing.T) {
	state := normalizeState(inputState{
		ActiveProfile: "staging",
		SelectedModel: "subconscious/new-model",
		Profiles:      []profileState{{Name: "default"}},
		Models:        []string{"subconscious/glm-5.3-marathon"},
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

func TestCatalogStatusLabelReflectsDiscoverySource(t *testing.T) {
	if got := catalogStatusLabel("available", "", false); got != "Provisioned models" {
		t.Fatalf("available label = %q", got)
	}
	if got := catalogStatusLabel("public", "", false); got != "Public catalog" {
		t.Fatalf("public label = %q", got)
	}
	if got := catalogStatusLabel("packaged", "timeout", false); got != "Packaged defaults" {
		t.Fatalf("packaged label = %q", got)
	}
	if got := catalogStatusLabel("packaged", "", true); got != "Fetching catalog..." {
		t.Fatalf("loading label = %q", got)
	}
}

func TestDefaultModelPickerDescriptionReflectsDiscoverySource(t *testing.T) {
	if got := defaultModelPickerDescription(inputState{ModelSource: "available"}); !strings.Contains(got, "saved as the default") {
		t.Fatalf("available description = %q", got)
	}
	if got := defaultModelPickerDescription(inputState{ModelSource: "public"}); !strings.Contains(got, "public models") {
		t.Fatalf("public description = %q", got)
	}
	if got := defaultModelPickerDescription(inputState{ModelSource: "packaged"}); !strings.Contains(got, "packaged models") {
		t.Fatalf("packaged description = %q", got)
	}
}

func TestAvailableModelsDetailShowsCatalogInsteadOfCommand(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		SelectedModel: "subconscious/glm-5.3-marathon",
		ModelSource:   "available",
		Models: []string{
			"subconscious/glm-5.3-marathon",
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
	if !strings.Contains(detail, "Provisioned models") {
		t.Fatalf("provisioned catalog status missing from detail: %q", detail)
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
	if err := os.WriteFile(path, []byte("GATEWAY_URL=https://old.example\nMODEL=subconscious/glm-5.3-marathon\n"), 0o600); err != nil {
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
	if !strings.Contains(text, "MODEL=subconscious/glm-5.3-marathon\n") {
		t.Fatalf("other profile settings were not preserved: %q", text)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	// Windows uses ACLs, not Unix owner/group mode bits. Keep the Unix
	// permission assertion while exercising the profile update on Windows.
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("profile mode = %o, want 600", info.Mode().Perm())
	}
}

func TestSetApiKeyQuitsWithUpdateKey(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "staging",
		Agents:        []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	for index, item := range m.items {
		if item.Kind == itemSetApiKey {
			m.cursor = index
			break
		}
	}
	detail := m.renderDetail(56)
	if strings.Contains(detail, "sk-") {
		t.Fatalf("detail should not preview a key: %q", detail)
	}
	updated, _ := m.updateMain("enter")
	editor := updated.(model)
	if editor.screen != screenSetApiKey {
		t.Fatalf("screen = %v, want set api key", editor.screen)
	}
	editor.apiKeyInput = "sk-secret-value"
	if strings.Contains(editor.renderSetApiKey(), "sk-secret-value") {
		t.Fatal("api key input is shown in cleartext")
	}
	finished, cmd := editor.updateSetApiKey(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("enter should quit")
	}
	got := finished.(model).result.Args
	want := []string{"-p", "staging", "update-key", "sk-secret-value"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("args = %#v, want %#v", got, want)
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

func TestUpdateBaseURLArrowKeysEditInsideDefault(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile:   "default",
		SavedGatewayURL: "https://gateway.example",
		GatewayURL:      "https://gateway.example",
	})
	for index, item := range m.items {
		if item.Kind == itemUpdateBaseURL {
			m.cursor = index
			break
		}
	}
	opened, _ := m.updateMain("enter")
	editor := opened.(model)
	if editor.urlInput != "https://gateway.example" {
		t.Fatalf("prefill = %q", editor.urlInput)
	}
	if editor.urlCursor != len([]rune(editor.urlInput)) {
		t.Fatalf("cursor = %d, want end", editor.urlCursor)
	}

	for range len("example") {
		next, _ := editor.updateBaseURL(tea.KeyPressMsg{Code: tea.KeyLeft})
		editor = next.(model)
	}
	typed, _ := editor.updateBaseURL(tea.KeyPressMsg{Code: 'x', Text: "x"})
	editor = typed.(model)
	if editor.urlInput != "https://gateway.xexample" {
		t.Fatalf("edited url = %q", editor.urlInput)
	}
	rendered := editor.renderGatewayURLInput()
	if !strings.Contains(rendered, "gateway.x▌example") {
		t.Fatalf("caret should sit after the inserted character: %q", rendered)
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

func TestUsageMenuItemIsAvailable(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		Agents:        []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	foundUsage := false
	foundPlatform := false
	for _, item := range m.items {
		if item.Command == "usage" {
			foundUsage = true
		}
		if item.Kind == itemUpdatePlatformURL {
			foundPlatform = true
		}
	}
	if !foundUsage {
		t.Fatalf("usage menu item missing: %#v", m.items)
	}
	if !foundPlatform {
		t.Fatalf("platform URL menu item missing: %#v", m.items)
	}
	foundFeedback := false
	for _, item := range m.items {
		if item.Name == "Give feedback" && item.Command == "feedback" && item.Kind == itemCommand {
			foundFeedback = true
		}
	}
	if !foundFeedback {
		t.Fatalf("feedback menu item missing: %#v", m.items)
	}
}

func TestUpdatePlatformURLUsesInlineDetail(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		PlatformURL:   "https://platform.example",
		Agents:        []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	for index, item := range m.items {
		if item.Kind == itemUpdatePlatformURL {
			m.cursor = index
			break
		}
	}
	detail := m.renderDetail(56)
	if !strings.Contains(detail, "https://platform.example") || !strings.Contains(detail, "Inline editor") {
		t.Fatalf("inline platform detail missing: %q", detail)
	}
	if strings.Contains(detail, "$ subc") {
		t.Fatalf("platform editor should not show a command preview: %q", detail)
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

func TestSessionsMenuSupportsNativeAndCrossHarnessResume(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		Sessions: []sessionState{{
			Key: "claude:session-1", Harness: "claude", HarnessName: "Claude Code",
			Title: "Repair auth", Cwd: "/work/auth", UpdatedAt: "2026-09-03T10:00:00Z", Portable: true,
		}},
		SessionHarnesses: []sessionHarnessState{
			{ID: "claude", Name: "Claude Code", Portable: true},
			{ID: "codex", Name: "Codex CLI", Portable: true},
			{ID: "sc", Name: "Subconscious Code", Portable: false},
		},
	})
	if m.items[0].Kind != itemSessions {
		t.Fatalf("first menu item = %#v, want sessions", m.items[0])
	}

	next, _ := m.updateMain("enter")
	m = next.(model)
	if m.screen != screenSessions {
		t.Fatalf("screen = %v, want sessions", m.screen)
	}
	next, _ = m.updateSessions("enter")
	m = next.(model)
	if m.screen != screenSessionHarnesses {
		t.Fatalf("screen = %v, want harnesses", m.screen)
	}
	options := m.sessionHarnessOptions()
	if len(options) != 2 || options[0].ID != "claude" || options[1].ID != "codex" {
		t.Fatalf("harness options = %#v", options)
	}

	next, _ = m.updateSessionHarnesses("down")
	m = next.(model)
	next, _ = m.updateSessionHarnesses("enter")
	m = next.(model)
	want := []string{"-p", "default", "sessions", "resume", "claude:session-1", "--harness", "codex"}
	if !reflect.DeepEqual(m.result.Args, want) {
		t.Fatalf("session result = %#v, want %#v", m.result.Args, want)
	}
}

func TestApplyStatePatchKeepsMainCursorAndClampsLists(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile:   "default",
		SelectedModel:   "subconscious/old",
		Models:          []string{"subconscious/old", "subconscious/two"},
		ModelsLoading:   true,
		SessionsLoading: true,
		Sessions: []sessionState{
			{Key: "claude:a", Harness: "claude", HarnessName: "Claude Code", Title: "A"},
			{Key: "claude:b", Harness: "claude", HarnessName: "Claude Code", Title: "B"},
		},
		Agents: []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	m.cursor = 3
	m.modelCursor = 2
	m.sessionCursor = 1

	models := []string{"subconscious/live"}
	sessions := []sessionState{{Key: "codex:1", Harness: "codex", HarnessName: "Codex CLI", Title: "Next"}}
	done := false
	source := "available"
	m = applyStatePatch(m, statePatch{
		Models:          &models,
		ModelSource:     &source,
		ModelsLoading:   &done,
		Sessions:        &sessions,
		SessionsLoading: &done,
	})
	if m.cursor != 3 {
		t.Fatalf("main cursor reset: %d", m.cursor)
	}
	if m.sessionCursor != 0 {
		t.Fatalf("session cursor = %d, want 0 after list shrink", m.sessionCursor)
	}
	if m.state.ModelsLoading || m.state.SessionsLoading {
		t.Fatalf("loading flags still set: %#v", m.state)
	}
	if m.state.ModelSource != "available" {
		t.Fatalf("source = %q", m.state.ModelSource)
	}
	if len(m.state.Sessions) != 1 || m.state.Sessions[0].Key != "codex:1" {
		t.Fatalf("sessions = %#v", m.state.Sessions)
	}
}

func TestLoadingViewsShowInFlightCopy(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile:   "default",
		ModelsLoading:   true,
		SessionsLoading: true,
		Agents:          []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	m.width = 100
	m.height = 40
	if header := m.renderHeader(m.width); !strings.Contains(header, "Fetching catalog...") {
		t.Fatalf("header missing fetching label: %q", header)
	}
	for index, item := range m.items {
		if item.Command == "models" {
			m.cursor = index
			break
		}
	}
	if detail := m.renderDetail(56); !strings.Contains(detail, "Fetching catalog...") {
		t.Fatalf("models detail missing fetching label: %q", detail)
	}
	for index, item := range m.items {
		if item.Kind == itemSessions {
			m.cursor = index
			break
		}
	}
	if detail := m.renderDetail(56); !strings.Contains(detail, "Scanning local sessions...") {
		t.Fatalf("sessions detail missing scanning label: %q", detail)
	}
	footer := m.loadingFooter()
	if !strings.Contains(footer, "Fetching catalog...") || !strings.Contains(footer, "Scanning sessions...") {
		t.Fatalf("loading footer = %q", footer)
	}
}

func TestUpdateOfferHandsOffToCommandPrompt(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile: "default",
		Version:       "4.0.1",
		Agents:        []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	available := true
	latest := "5.0.0"
	m = applyStatePatch(m, statePatch{UpdateAvailable: &available, LatestVersion: &latest})
	offered, cmd := m.offerUpdate()
	if cmd == nil {
		t.Fatal("an available update should leave the TUI for the shared prompt")
	}
	if !offered.result.UpdatePrompt || offered.result.InstalledVersion != "4.0.1" || offered.result.LatestVersion != "5.0.0" {
		t.Fatalf("prompt result = %#v", offered.result)
	}
	editing := m
	editing.screen = screenUpdateBaseURL
	stayed, stayCmd := editing.offerUpdate()
	if stayCmd != nil || stayed.screen != screenUpdateBaseURL {
		t.Fatal("update prompt interrupted an open editor")
	}
}

func TestUpdateAvailableFooter(t *testing.T) {
	m := newModel(inputState{
		ActiveProfile:   "default",
		UpdateAvailable: true,
		LatestVersion:   "4.2.0",
		Agents:          []agentState{{Command: "claude", Name: "Claude Code", Action: "Launch", Launch: true}},
	})
	m.width = 100
	m.height = 40
	if view := m.renderMain(m.width); !strings.Contains(view, "CLI update available. Run subc upgrade.") {
		t.Fatalf("update footer missing: %q", view)
	}
}

func TestDefaultModelDisplayUsesFetchingLabelWhileLoading(t *testing.T) {
	if got := defaultModelDisplay(inputState{ModelsLoading: true}); got != "Fetching catalog..." {
		t.Fatalf("unset loading display = %q", got)
	}
	if got := defaultModelDisplay(inputState{SelectedModel: "subconscious/foo", ModelsLoading: true}); got != "subconscious/foo" {
		t.Fatalf("selected loading display = %q", got)
	}
}
