package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

const (
	brandOrange = "#FF5C27"
	brandDim    = "#B84A1E"
	textColor   = "#F3EFEA"
	mutedColor  = "#8B8580"
	faintColor  = "#4E4945"
	greenColor  = "#6FD49A"
)

var logo = []string{
	"   ███▄  ▄███",
	"   ████  ████",
	"       ██",
	"▄██▄▄ ▄██▄ ▄▄██▄",
	"▀███▀ ▀██▀ ▀███▀",
	"       ██",
	"   ████  ████",
	"   ███▀  ▀███",
}

type profileState struct {
	Name          string `json:"name"`
	Model         string `json:"model"`
	SubagentModel string `json:"subagentModel"`
	Authenticated bool   `json:"authenticated"`
}

type agentState struct {
	Command     string `json:"command"`
	Name        string `json:"name"`
	Action      string `json:"action"`
	Description string `json:"description"`
	Launch      bool   `json:"launch"`
}

type inputState struct {
	Version           string         `json:"version"`
	ActiveProfile     string         `json:"activeProfile"`
	ProfilePath       string         `json:"profilePath"`
	Profiles          []profileState `json:"profiles"`
	Models            []string       `json:"models"`
	SelectedModel     string         `json:"selectedModel"`
	SubagentModel     string         `json:"subagentModel"`
	GatewayURL        string         `json:"gatewayUrl"`
	SavedGatewayURL   string         `json:"savedGatewayUrl"`
	GatewayOverridden bool           `json:"gatewayOverridden"`
	ModelError        string         `json:"modelError"`
	Agents            []agentState   `json:"agents"`
}

type outputResult struct {
	Args    []string `json:"args"`
	BaseURL string   `json:"baseUrl,omitempty"`
}

type itemKind int

const (
	itemAgent itemKind = iota
	itemCommand
	itemCreateProfile
	itemSetDefaultModel
	itemSetSubagentModel
	itemUpdateBaseURL
)

type menuItem struct {
	Section     string
	Name        string
	Command     string
	Action      string
	Description string
	Kind        itemKind
	Launch      bool
}

type screen int

const (
	screenMain screen = iota
	screenProfiles
	screenSetDefaultModel
	screenSetSubagentModel
	screenCreateProfile
	screenUpdateBaseURL
)

type model struct {
	state          inputState
	items          []menuItem
	cursor         int
	profileCursor  int
	modelCursor    int
	subagentCursor int
	screen         screen
	profileInput   string
	urlInput       string
	inputError     string
	notice         string
	sessionBaseURL string
	width          int
	height         int
	result         outputResult
}

func newModel(state inputState) model {
	state = normalizeState(state)
	items := make([]menuItem, 0, len(state.Agents)+7)
	for _, agent := range state.Agents {
		items = append(items, menuItem{
			Section:     "Coding agents",
			Name:        agent.Name,
			Command:     agent.Command,
			Action:      agent.Action,
			Description: agent.Description,
			Kind:        itemAgent,
			Launch:      agent.Launch,
		})
	}
	items = append(items,
		menuItem{Section: "Account & configuration", Name: "Sign in", Command: "login", Action: "Authenticate", Description: "Authenticate this profile and securely save its Subconscious API key.", Kind: itemCommand},
		menuItem{Section: "Account & configuration", Name: "Available models", Command: "models", Action: "Inspect", Description: "Fetch and display the live model catalog from the selected gateway.", Kind: itemCommand},
		menuItem{Section: "Account & configuration", Name: "Set default model", Command: "config", Action: "Configure", Description: "Choose and save the default model for the selected profile.", Kind: itemSetDefaultModel},
		menuItem{Section: "Account & configuration", Name: "Set subagent model", Command: "config", Action: "Configure", Description: "Choose the model Claude Code uses for subagents, or follow the default model.", Kind: itemSetSubagentModel},
		menuItem{Section: "Account & configuration", Name: "Update base URL", Command: "update-url", Action: "Configure", Description: "Validate and save a new gateway base URL without leaving the TUI.", Kind: itemUpdateBaseURL},
		menuItem{Section: "Account & configuration", Name: "Create profile", Command: "config", Action: "Create", Description: "Create an isolated profile with its own gateway, model, and agent settings.", Kind: itemCreateProfile},
		menuItem{Section: "Account & configuration", Name: "Profile settings", Command: "config", Action: "Configure", Description: "View the selected profile, gateway URL, model, and agent settings.", Kind: itemCommand},
		menuItem{Section: "Account & configuration", Name: "Upgrade CLI", Command: "upgrade", Action: "Update", Description: "Check npm and install the latest published Subconscious CLI.", Kind: itemCommand},
	)

	profileCursor := indexProfile(state.Profiles, state.ActiveProfile)
	modelCursor := max(0, indexString(state.Models, state.SelectedModel))
	subagentCursor := subagentModelIndex(state)
	return model{
		state:          state,
		items:          items,
		profileCursor:  profileCursor,
		modelCursor:    modelCursor,
		subagentCursor: subagentCursor,
	}
}

func normalizeState(state inputState) inputState {
	if state.ActiveProfile == "" {
		state.ActiveProfile = "default"
	}
	if len(state.Profiles) == 0 {
		state.Profiles = []profileState{{Name: state.ActiveProfile, Model: state.SelectedModel, SubagentModel: state.SubagentModel}}
	}
	if indexProfile(state.Profiles, state.ActiveProfile) < 0 {
		state.Profiles = append([]profileState{{Name: state.ActiveProfile, Model: state.SelectedModel, SubagentModel: state.SubagentModel}}, state.Profiles...)
	}
	if state.SelectedModel == "" && len(state.Models) > 0 {
		state.SelectedModel = state.Models[0]
	}
	if state.SelectedModel != "" && indexString(state.Models, state.SelectedModel) < 0 {
		state.Models = append([]string{state.SelectedModel}, state.Models...)
	}
	if state.SubagentModel != "" && indexString(state.Models, state.SubagentModel) < 0 {
		state.Models = append(state.Models, state.SubagentModel)
	}
	return state
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case tea.KeyPressMsg:
		key := msg.String()
		if key == "ctrl+c" {
			return m, tea.Quit
		}
		switch m.screen {
		case screenProfiles:
			return m.updateProfiles(key)
		case screenSetDefaultModel:
			return m.updateModels(key)
		case screenSetSubagentModel:
			return m.updateSubagentModels(key)
		case screenCreateProfile:
			return m.updateCreateProfile(msg)
		case screenUpdateBaseURL:
			return m.updateBaseURL(msg)
		default:
			return m.updateMain(key)
		}
	}
	return m, nil
}

func (m model) updateMain(key string) (tea.Model, tea.Cmd) {
	switch key {
	case "q", "esc":
		return m, tea.Quit
	case "up", "k":
		m.cursor = wrapIndex(m.cursor-1, len(m.items))
	case "down", "j":
		m.cursor = wrapIndex(m.cursor+1, len(m.items))
	case "home", "g":
		m.cursor = 0
	case "end", "G":
		m.cursor = len(m.items) - 1
	case "p":
		m.profileCursor = indexProfile(m.state.Profiles, m.state.ActiveProfile)
		m.screen = screenProfiles
	case "enter":
		item := m.items[m.cursor]
		if item.Kind == itemSetDefaultModel {
			if len(m.state.Models) > 0 {
				m.modelCursor = max(0, indexString(m.state.Models, m.state.SelectedModel))
				m.screen = screenSetDefaultModel
			}
			return m, nil
		}
		if item.Kind == itemSetSubagentModel {
			m.subagentCursor = subagentModelIndex(m.state)
			m.screen = screenSetSubagentModel
			return m, nil
		}
		if item.Kind == itemCreateProfile {
			m.profileInput = ""
			m.inputError = ""
			m.screen = screenCreateProfile
			return m, nil
		}
		if item.Kind == itemUpdateBaseURL {
			m.urlInput = m.state.SavedGatewayURL
			if m.urlInput == "" {
				m.urlInput = m.state.GatewayURL
			}
			m.inputError = ""
			m.screen = screenUpdateBaseURL
			return m, nil
		}
		m.result.Args = actionArgs(item, m.state.ActiveProfile, m.state.SelectedModel, m.state.SubagentModel)
		m.result.BaseURL = m.sessionBaseURL
		return m, tea.Quit
	}
	return m, nil
}

func (m model) updateProfiles(key string) (tea.Model, tea.Cmd) {
	switch key {
	case "q", "esc", "p":
		m.screen = screenMain
	case "up", "k":
		m.profileCursor = wrapIndex(m.profileCursor-1, len(m.state.Profiles))
	case "down", "j":
		m.profileCursor = wrapIndex(m.profileCursor+1, len(m.state.Profiles))
	case "enter":
		selected := m.state.Profiles[m.profileCursor]
		m.state.ActiveProfile = selected.Name
		if selected.Model != "" {
			m.state.SelectedModel = selected.Model
			if indexString(m.state.Models, selected.Model) < 0 {
				m.state.Models = append([]string{selected.Model}, m.state.Models...)
			}
			m.modelCursor = indexString(m.state.Models, selected.Model)
		}
		m.state.SubagentModel = selected.SubagentModel
		if selected.SubagentModel != "" && indexString(m.state.Models, selected.SubagentModel) < 0 {
			m.state.Models = append(m.state.Models, selected.SubagentModel)
		}
		m.subagentCursor = subagentModelIndex(m.state)
		m.screen = screenMain
	}
	return m, nil
}

func (m model) updateModels(key string) (tea.Model, tea.Cmd) {
	switch key {
	case "q", "esc":
		m.screen = screenMain
	case "up", "k":
		m.modelCursor = wrapIndex(m.modelCursor-1, len(m.state.Models))
	case "down", "j":
		m.modelCursor = wrapIndex(m.modelCursor+1, len(m.state.Models))
	case "enter":
		m.result.Args = []string{"-p", m.state.ActiveProfile, "config", "--model", m.state.Models[m.modelCursor]}
		return m, tea.Quit
	}
	return m, nil
}

func (m model) updateSubagentModels(key string) (tea.Model, tea.Cmd) {
	options := subagentModelOptions(m.state)
	switch key {
	case "q", "esc":
		m.screen = screenMain
	case "up", "k":
		m.subagentCursor = wrapIndex(m.subagentCursor-1, len(options))
	case "down", "j":
		m.subagentCursor = wrapIndex(m.subagentCursor+1, len(options))
	case "enter":
		selected := "follow-default"
		if m.subagentCursor > 0 {
			selected = options[m.subagentCursor]
		}
		m.result.Args = []string{"-p", m.state.ActiveProfile, "config", "--subagent-model", selected}
		return m, tea.Quit
	}
	return m, nil
}

var profileNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]*$`)

func (m model) updateCreateProfile(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := msg.String()
	switch key {
	case "esc":
		m.screen = screenMain
		m.inputError = ""
	case "backspace", "ctrl+h":
		runes := []rune(m.profileInput)
		if len(runes) > 0 {
			m.profileInput = string(runes[:len(runes)-1])
		}
		m.inputError = ""
	case "enter":
		if !profileNamePattern.MatchString(m.profileInput) {
			m.inputError = "Use letters, digits, _ or -; begin with a letter or digit."
			return m, nil
		}
		if indexProfile(m.state.Profiles, m.profileInput) >= 0 {
			m.inputError = "That profile already exists."
			return m, nil
		}
		m.result.Args = []string{"-p", m.profileInput, "config", "create"}
		return m, tea.Quit
	default:
		text := msg.Key().Text
		if text != "" && utf8.RuneCountInString(m.profileInput+text) <= 64 {
			m.profileInput += text
			m.inputError = ""
		}
	}
	return m, nil
}

func (m model) updateBaseURL(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := msg.String()
	switch key {
	case "esc":
		m.screen = screenMain
		m.inputError = ""
	case "backspace", "ctrl+h":
		runes := []rune(m.urlInput)
		if len(runes) > 0 {
			m.urlInput = string(runes[:len(runes)-1])
		}
		m.inputError = ""
	case "ctrl+u":
		m.urlInput = ""
		m.inputError = ""
	case "enter":
		normalized, err := normalizeBaseURL(m.urlInput)
		if err != nil {
			m.inputError = err.Error()
			return m, nil
		}
		if err := updateProfileValue(m.state.ProfilePath, "GATEWAY_URL", normalized); err != nil {
			m.inputError = "Could not save the profile: " + err.Error()
			return m, nil
		}
		m.state.SavedGatewayURL = normalized
		m.state.GatewayURL = normalized
		m.sessionBaseURL = normalized
		m.notice = "Base URL saved to profile " + m.state.ActiveProfile + "."
		if m.state.GatewayOverridden {
			m.notice += " Your shell override still applies on the next run."
		}
		m.screen = screenMain
		m.inputError = ""
	default:
		text := msg.Key().Text
		if text != "" && utf8.RuneCountInString(m.urlInput+text) <= 512 {
			m.urlInput += text
			m.inputError = ""
		}
	}
	return m, nil
}

func normalizeBaseURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("Enter a valid http:// or https:// URL.")
	}
	if parsed.User != nil {
		return "", errors.New("The URL cannot contain embedded credentials.")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("The URL cannot contain a query string or fragment.")
	}
	return strings.TrimRight(value, "/"), nil
}

func updateProfileValue(path, key, value string) error {
	if path == "" {
		return errors.New("profile path is unavailable")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	prefix := key + "="
	found := false
	for index, line := range lines {
		trimmed := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "export "))
		if strings.HasPrefix(trimmed, prefix) {
			lines[index] = prefix + value
			found = true
			break
		}
	}
	if !found {
		if len(lines) == 1 && lines[0] == "" {
			lines = []string{prefix + value}
		} else {
			lines = append(lines, prefix+value)
		}
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func actionArgs(item menuItem, profile, selectedModel, subagentModel string) []string {
	if item.Kind == itemSetDefaultModel {
		return []string{"-p", profile, "config", "--model", selectedModel}
	}
	if item.Kind == itemSetSubagentModel {
		if subagentModel == "" {
			subagentModel = "follow-default"
		}
		return []string{"-p", profile, "config", "--subagent-model", subagentModel}
	}
	if item.Kind == itemCreateProfile {
		return []string{"-p", "<name>", "config", "create"}
	}
	args := []string{"-p", profile, item.Command}
	if item.Kind == itemAgent && item.Launch && selectedModel != "" {
		args = append(args, "--model", selectedModel)
	}
	return args
}

func (m model) View() tea.View {
	width := m.width
	if width < 40 {
		width = 40
	}
	var content string
	if m.screen == screenProfiles {
		content = m.renderPicker("Select profile", profileNames(m.state.Profiles), m.profileCursor, "Profiles keep gateway, model, and agent settings separate.")
	} else if m.screen == screenSetDefaultModel {
		description := "This model will be saved as the default for the selected profile."
		if m.state.ModelError != "" {
			description = "Live catalog unavailable; packaged models are shown."
		}
		content = m.renderPicker("Set default model", m.state.Models, m.modelCursor, description)
	} else if m.screen == screenSetSubagentModel {
		content = m.renderPicker("Set subagent model", subagentModelOptions(m.state), m.subagentCursor, "Choose the model Claude Code uses for subagents. Follow default keeps it in sync with the profile model.")
	} else if m.screen == screenCreateProfile {
		content = m.renderProfileInput()
	} else if m.screen == screenUpdateBaseURL {
		content = m.renderURLInput()
	} else {
		content = m.renderMain(width)
	}

	view := tea.NewView(content)
	view.AltScreen = true
	view.WindowTitle = "Subconscious CLI"
	return view
}

func (m model) renderMain(width int) string {
	header := m.renderHeader(width)
	bodyWidth := max(36, width-4)
	menuWidth := bodyWidth
	if width >= 82 {
		menuWidth = min(38, max(30, bodyWidth/3))
	}
	menu := m.renderMenu(menuWidth)

	var body string
	if width >= 82 {
		detailWidth := max(36, bodyWidth-menuWidth-3)
		detail := m.renderDetail(detailWidth)
		body = lipgloss.JoinHorizontal(lipgloss.Top, menu, "   ", detail)
	} else {
		body = menu + "\n\n" + m.renderDetail(bodyWidth)
	}

	footer := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(
		"↑/↓ navigate   enter select   p switch profile   subc --help   q quit",
	)
	if m.notice != "" {
		footer = lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Render("✓ "+m.notice) + "\n" + footer
	}
	return lipgloss.NewStyle().Padding(1, 2).Render(header + "\n\n" + body + "\n\n" + footer)
}

func (m model) renderHeader(width int) string {
	orange := lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange))
	if width < 66 || m.height < 20 {
		title := orange.Bold(true).Render("✻  Subconscious")
		version := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("CLI v" + m.state.Version)
		return title + "  " + version
	}

	logoBlock := orange.Render(strings.Join(logo, "\n"))
	profile := currentProfile(m.state)
	auth := lipgloss.NewStyle().Foreground(lipgloss.Color(greenColor)).Render("● authenticated")
	if !profile.Authenticated {
		auth = lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("○ sign in required")
	}
	title := orange.Bold(true).Render("Subconscious CLI")
	if m.state.Version != "" {
		title += "  " + lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("v"+m.state.Version)
	}
	info := strings.Join([]string{
		title,
		lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("Native terminal control center"),
		"",
		lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Render("Profile  ") + orange.Render(m.state.ActiveProfile) + "  " + auth,
		lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Render("Model    ") + lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(ellipsize(m.state.SelectedModel, max(20, width-48))),
		lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Render("Subagent ") + lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(ellipsize(subagentModelDisplay(m.state), max(20, width-48))),
	}, "\n")
	return lipgloss.JoinHorizontal(lipgloss.Bottom, logoBlock, "   ", info)
}

func (m model) renderMenu(width int) string {
	var lines []string
	lastSection := ""
	actionWidth := 0
	for _, item := range m.items {
		actionWidth = max(actionWidth, utf8.RuneCountInString(item.Action))
	}
	for index, item := range m.items {
		if item.Section != lastSection {
			if len(lines) > 0 {
				lines = append(lines, "")
			}
			lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Bold(true).Render(item.Section))
			lastSection = item.Section
		}

		labelWidth := max(12, width-actionWidth-4)
		label := ellipsize(item.Name, labelWidth)
		row := menuRowText(label, item.Action, labelWidth, actionWidth, false)
		if index == m.cursor {
			row = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#111111")).
				Background(lipgloss.Color(brandOrange)).
				Bold(true).
				Width(width).
				Render(menuRowText(label, item.Action, labelWidth, actionWidth, true))
		} else {
			row = lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Width(width).Render(row)
		}
		lines = append(lines, row)
	}
	return strings.Join(lines, "\n")
}

func menuRowText(label, action string, labelWidth, actionWidth int, selected bool) string {
	pointer := "  "
	if selected {
		pointer = "› "
	}
	labelPadding := strings.Repeat(" ", max(0, labelWidth-utf8.RuneCountInString(label)))
	actionPadding := strings.Repeat(" ", max(0, actionWidth-utf8.RuneCountInString(action)))
	return pointer + label + labelPadding + "  " + action + actionPadding
}

func (m model) renderDetail(width int) string {
	item := m.items[m.cursor]
	if item.Command == "models" {
		return m.renderModelCatalog(width)
	}
	if item.Kind == itemUpdateBaseURL {
		return m.renderGatewayDetail(width)
	}
	title := lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Bold(true).Render(item.Name)
	action := lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Render(item.Action)
	description := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(wrapText(item.Description, max(24, width-4)))
	command := strings.Join(actionArgs(item, m.state.ActiveProfile, m.state.SelectedModel, m.state.SubagentModel), " ")
	preview := lipgloss.NewStyle().Foreground(lipgloss.Color(brandDim)).Render("$ subc " + command)

	lines := []string{title + "  " + action, "", description, "", preview}
	if item.Kind == itemAgent && item.Launch {
		lines = append(lines, "", lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("Model"), ellipsize(m.state.SelectedModel, max(20, width-4)))
	}
	if m.state.GatewayURL != "" {
		lines = append(lines, "", lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("Gateway"), ellipsize(m.state.GatewayURL, max(20, width-4)))
	}

	return lipgloss.NewStyle().
		Border(lipgloss.NormalBorder(), false, false, false, true).
		BorderForeground(lipgloss.Color(faintColor)).
		PaddingLeft(2).
		Width(width).
		Render(strings.Join(lines, "\n"))
}

func (m model) renderGatewayDetail(width int) string {
	title := lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Bold(true).Render("Update base URL")
	action := lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Render("Inline editor")
	lines := []string{
		title + "  " + action,
		"",
		lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(wrapText("Press Enter to edit and save the active profile's gateway without leaving the TUI.", max(24, width-4))),
		"",
		lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("Current base URL"),
		ellipsize(m.state.GatewayURL, max(20, width-4)),
	}
	return lipgloss.NewStyle().
		Border(lipgloss.NormalBorder(), false, false, false, true).
		BorderForeground(lipgloss.Color(faintColor)).
		PaddingLeft(2).
		Width(width).
		Render(strings.Join(lines, "\n"))
}

func (m model) renderModelCatalog(width int) string {
	title := lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Bold(true).Render("Available models")
	status := lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Render("Live catalog")
	if m.state.ModelError != "" {
		status = lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("Packaged defaults")
	}

	lines := []string{title + "  " + status, ""}
	for _, modelID := range m.state.Models {
		marker := "  "
		label := ellipsize(modelID, max(20, width-9))
		if modelID == m.state.SelectedModel {
			marker = lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Render("● ")
			label += lipgloss.NewStyle().Foreground(lipgloss.Color(brandDim)).Render("  default")
		} else {
			marker = lipgloss.NewStyle().Foreground(lipgloss.Color(faintColor)).Render("○ ")
		}
		lines = append(lines, marker+label)
	}
	if len(m.state.Models) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("No models returned by the gateway."))
	}
	if m.state.ModelError != "" {
		lines = append(lines, "", lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(wrapText(m.state.ModelError, max(24, width-4))))
	}
	if m.state.GatewayURL != "" {
		lines = append(lines, "", lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("Gateway"), ellipsize(m.state.GatewayURL, max(20, width-4)))
	}

	return lipgloss.NewStyle().
		Border(lipgloss.NormalBorder(), false, false, false, true).
		BorderForeground(lipgloss.Color(faintColor)).
		PaddingLeft(2).
		Width(width).
		Render(strings.Join(lines, "\n"))
}

func (m model) renderPicker(title string, items []string, cursor int, description string) string {
	width := min(max(42, m.width-8), 76)
	if len(items) == 0 {
		items = []string{"No options available"}
		cursor = 0
	}
	var rows []string
	for index, item := range items {
		label := ellipsize(item, width-6)
		if index == cursor {
			rows = append(rows, lipgloss.NewStyle().Foreground(lipgloss.Color("#111111")).Background(lipgloss.Color(brandOrange)).Bold(true).Width(width-4).Render("› "+label))
		} else {
			rows = append(rows, lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Width(width-4).Render("  "+label))
		}
	}

	heading := lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Bold(true).Render("✻  " + title)
	copy := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(wrapText(description, width-4))
	footer := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("↑/↓ navigate   enter select   esc back")
	panel := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color(brandOrange)).
		Padding(1, 2).
		Width(width).
		Render(heading + "\n" + copy + "\n\n" + strings.Join(rows, "\n") + "\n\n" + footer)
	return lipgloss.Place(max(width+4, m.width), max(12, m.height), lipgloss.Center, lipgloss.Center, panel)
}

func (m model) renderProfileInput() string {
	width := min(max(46, m.width-8), 72)
	heading := lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Bold(true).Render("✻  Create profile")
	copy := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(
		wrapText("Profiles keep credentials, gateway, model, and agent settings isolated.", width-4),
	)
	value := m.profileInput
	if value == "" {
		value = lipgloss.NewStyle().Foreground(lipgloss.Color(faintColor)).Render("profile-name")
	}
	field := lipgloss.NewStyle().
		Foreground(lipgloss.Color(textColor)).
		Border(lipgloss.NormalBorder(), false, false, true, false).
		BorderForeground(lipgloss.Color(brandOrange)).
		Width(width - 10).
		Render(value + "▌")
	errorLine := ""
	if m.inputError != "" {
		errorLine = "\n" + lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Render(wrapText(m.inputError, width-4))
	}
	footer := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("type a name   enter create   esc cancel")
	panel := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color(brandOrange)).
		Padding(1, 2).
		Width(width).
		Render(heading + "\n" + copy + "\n\n" + field + errorLine + "\n\n" + footer)
	return lipgloss.Place(max(width+4, m.width), max(12, m.height), lipgloss.Center, lipgloss.Center, panel)
}

func (m model) renderURLInput() string {
	width := min(max(50, m.width-8), 78)
	heading := lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Bold(true).Render("✻  Update base URL")
	copy := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render(
		wrapText("Save the gateway URL directly to profile "+m.state.ActiveProfile+".", width-8),
	)
	value := m.urlInput
	if value == "" {
		value = lipgloss.NewStyle().Foreground(lipgloss.Color(faintColor)).Render("https://api.subconscious.dev")
	}
	field := lipgloss.NewStyle().
		Foreground(lipgloss.Color(textColor)).
		Border(lipgloss.NormalBorder(), false, false, true, false).
		BorderForeground(lipgloss.Color(brandOrange)).
		Width(width - 12).
		Render(ellipsize(value, width-14) + "▌")
	errorLine := ""
	if m.inputError != "" {
		errorLine = "\n" + lipgloss.NewStyle().Foreground(lipgloss.Color(brandOrange)).Render(wrapText(m.inputError, width-8))
	}
	footer := lipgloss.NewStyle().Foreground(lipgloss.Color(mutedColor)).Render("ctrl+u clear   enter save   esc cancel")
	panel := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color(brandOrange)).
		Padding(1, 2).
		Width(width).
		Render(heading + "\n" + copy + "\n\n" + field + errorLine + "\n\n" + footer)
	return lipgloss.Place(max(width+4, m.width), max(12, m.height), lipgloss.Center, lipgloss.Center, panel)
}

func currentProfile(state inputState) profileState {
	index := indexProfile(state.Profiles, state.ActiveProfile)
	if index >= 0 {
		return state.Profiles[index]
	}
	return profileState{Name: state.ActiveProfile, Model: state.SelectedModel, SubagentModel: state.SubagentModel}
}

func subagentModelOptions(state inputState) []string {
	return append([]string{"Follow default model"}, state.Models...)
}

func subagentModelIndex(state inputState) int {
	if state.SubagentModel == "" {
		return 0
	}
	index := indexString(state.Models, state.SubagentModel)
	if index < 0 {
		return 0
	}
	return index + 1
}

func subagentModelDisplay(state inputState) string {
	if state.SubagentModel != "" {
		return state.SubagentModel
	}
	return state.SelectedModel + " (follows default)"
}

func profileNames(profiles []profileState) []string {
	names := make([]string, 0, len(profiles))
	for _, profile := range profiles {
		names = append(names, profile.Name)
	}
	return names
}

func indexProfile(profiles []profileState, name string) int {
	for index, profile := range profiles {
		if profile.Name == name {
			return index
		}
	}
	return -1
}

func indexString(values []string, value string) int {
	for index, candidate := range values {
		if candidate == value {
			return index
		}
	}
	return -1
}

func wrapIndex(index, length int) int {
	if length <= 0 {
		return 0
	}
	if index < 0 {
		return length - 1
	}
	if index >= length {
		return 0
	}
	return index
}

func ellipsize(value string, width int) string {
	if width <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= width {
		return value
	}
	if width == 1 {
		return "…"
	}
	return string(runes[:width-1]) + "…"
}

func wrapText(value string, width int) string {
	if width <= 0 {
		return value
	}
	words := strings.Fields(value)
	if len(words) == 0 {
		return ""
	}
	var lines []string
	line := words[0]
	for _, word := range words[1:] {
		if utf8.RuneCountInString(line)+1+utf8.RuneCountInString(word) <= width {
			line += " " + word
			continue
		}
		lines = append(lines, line)
		line = word
	}
	return strings.Join(append(lines, line), "\n")
}

func readState(path string) (inputState, error) {
	if path == "" {
		return inputState{}, errors.New("--state is required")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return inputState{}, err
	}
	var state inputState
	if err := json.Unmarshal(data, &state); err != nil {
		return inputState{}, err
	}
	if len(state.Agents) == 0 {
		return inputState{}, errors.New("state contains no coding agents")
	}
	return state, nil
}

func writeResult(path string, result outputResult) error {
	if path == "" || len(result.Args) == 0 {
		return nil
	}
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func run() error {
	statePath := flag.String("state", "", "path to TUI input state JSON")
	resultPath := flag.String("result", "", "path to write the selected command JSON")
	flag.Parse()

	state, err := readState(*statePath)
	if err != nil {
		return err
	}
	final, err := tea.NewProgram(newModel(state)).Run()
	if err != nil {
		return err
	}
	selected, ok := final.(model)
	if !ok {
		return errors.New("unexpected terminal model result")
	}
	return writeResult(*resultPath, selected.result)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "subc tui:", err)
		os.Exit(1)
	}
}
