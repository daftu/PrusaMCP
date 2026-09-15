// SPDX-License-Identifier: AGPL-3.0-or-later
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"
#include <boost/log/core.hpp>
#include <boost/property_tree/ini_parser.hpp>
#include <nlohmann/json.hpp>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <unistd.h>
using namespace Slic3r;
using json = nlohmann::json;

static bool omitted(const std::string &key) {
    return key == "post_process" || key == "print_host" ||
        key == "physical_printer" || key == "physical_printer_settings_id" || key.rfind("printhost_", 0) == 0;
}
static DynamicPrintConfig sanitize(const DynamicPrintConfig &source, std::set<std::string> &removed) {
    DynamicPrintConfig config(source);
    for (const auto &key : config.keys()) if (omitted(key)) {
        removed.insert(key);
        config.erase(key);
    }
    config.erase("inherits");
    return config;
}
static std::vector<PresetCollection*> collections(PresetBundle &bundle) {
    return {&bundle.prints, &bundle.filaments, &bundle.sla_prints, &bundle.sla_materials, &bundle.printers};
}
static json profile(const PresetCollection &collection, const Preset &preset) {
    json settings = json::object();
    for (const auto &key : preset.config.keys()) settings[key] = preset.config.opt_serialize(key);
    return {{"kind", collection.section_name()}, {"name", preset.name}, {"settings", settings}};
}
static const Preset &select(PresetCollection &collection, const std::string &name) {
    const Preset *preset = collection.find_preset(name, false, false);
    if (!preset || preset->is_default) throw std::runtime_error("unknown_preset");
    collection.select_preset_by_name(name, true, true);
    return collection.get_selected_preset();
}
static void copy(PresetBundle &target, PresetCollection &source, const Preset &preset, std::set<std::string> &removed) {
    target.get_presets(source.type()).load_preset("", preset.name, sanitize(preset.config, removed), false);
}
static json run(const json &request) {
    const std::string operation = request.at("operation").get<std::string>();
    if (operation != "import" && operation != "resolve") throw std::runtime_error("invalid_selection");
    set_data_dir(request.at("datadir").get<std::string>());
    PresetBundle bundle;
    bundle.setup_directories();
    AppConfig app{AppConfig::EAppMode::Editor};
    const std::string app_path = request.at("datadir").get<std::string>() + "/PrusaSlicer.ini";
    if (std::ifstream(app_path).good() && !app.load(app_path).empty()) throw std::runtime_error("native_configuration_rejected");
    bundle.load_presets(app, ForwardCompatibilitySubstitutionRule::EnableSystemSilent);
    PresetsConfigSubstitutions substitutions;
    std::set<std::string> imported_sections;
    if (request.contains("bundle_path")) {
        boost::property_tree::ptree source;
        boost::property_tree::read_ini(request.at("bundle_path").get<std::string>(), source);
        for (const auto &section : source) imported_sections.insert(section.first);
        for (auto *collection : collections(bundle)) {
            std::vector<std::string> collisions;
            for (const auto &preset : collection->get_presets())
                if (preset.is_system && imported_sections.count(collection->section_name() + ":" + preset.name)) collisions.push_back(preset.name);
            for (const auto &name : collisions) collection->delete_preset(name);
        }
        auto result = bundle.load_configbundle(request.at("bundle_path").get<std::string>(), {}, ForwardCompatibilitySubstitutionRule::Enable);
        substitutions = std::move(result.first);
        if (result.second == 0) throw std::runtime_error("native_configuration_rejected");
    }
    PresetBundle output;
    std::set<std::string> removed;
    json result = {{"protocol", 1}, {"version", "2.9.6"}, {"profiles", json::array()}, {"substitutions", json::array()}};
    for (const auto &sub : substitutions) for (const auto &item : sub.substitutions)
        if (item.opt_def) result["substitutions"].push_back({{"kind", bundle.get_presets(sub.preset_type).section_name()}, {"name", sub.preset_name}, {"key", item.opt_def->opt_key}});
    if (operation == "import") {
        for (auto *collection : collections(bundle)) for (const auto &preset : collection->get_presets())
            if (!preset.is_default && !preset.is_system && !preset.is_external && imported_sections.count(collection->section_name() + ":" + preset.name)) copy(output, *collection, preset, removed);
    } else {
        const auto &selection = request.at("selection");
        const std::string printer_name = selection.at("printer").get<std::string>();
        const std::string print_name = selection.at("print").get<std::string>();
        const std::vector<std::string> material_names = selection.at("materials").get<std::vector<std::string>>();
        const auto &printer = select(bundle.printers, printer_name);
        const bool sla = printer.printer_technology() == ptSLA;
        auto &prints = sla ? bundle.sla_prints : bundle.prints;
        auto &materials = sla ? bundle.sla_materials : bundle.filaments;
        const auto &print = select(prints, print_name);
        const auto printer_vendor = bundle.printers.get_preset_with_vendor_profile(printer);
        const auto print_vendor = prints.get_preset_with_vendor_profile(print);
        if (!is_compatible_with_printer(print_vendor, printer_vendor)) throw std::runtime_error("incompatible_preset");
        const size_t material_count = sla ? 1 : printer.config.option<ConfigOptionFloats>("nozzle_diameter")->values.size();
        if (material_names.size() != material_count) throw std::runtime_error("invalid_selection");
        bundle.update_multi_material_filament_presets();
        for (size_t i = 0; i < material_names.size(); ++i) {
            const auto &material = select(materials, material_names[i]);
            const auto material_vendor = materials.get_preset_with_vendor_profile(material);
            if (!is_compatible_with_printer(material_vendor, printer_vendor) || !is_compatible_with_print(material_vendor, print_vendor, printer_vendor)) throw std::runtime_error("incompatible_preset");
            if (!sla) bundle.set_filament_preset(i, material_names[i]);
            copy(output, materials, material, removed);
        }
        copy(output, bundle.printers, printer, removed);
        copy(output, prints, print, removed);
        select(output.printers, printer_name);
        select(sla ? output.sla_prints : output.prints, print_name);
        output.update_multi_material_filament_presets();
        for (size_t i = 0; i < material_names.size(); ++i) {
            select(sla ? output.sla_materials : output.filaments, material_names[i]);
            if (!sla) output.set_filament_preset(i, material_names[i]);
        }
        auto effective = bundle.full_config();
        if (request.contains("overrides_path")) {
            DynamicPrintConfig overrides;
            overrides.load(request.at("overrides_path").get<std::string>(), ForwardCompatibilitySubstitutionRule::Disable);
            effective.apply(overrides);
        }
        if (!sla) effective.normalize_fdm();
        if (!effective.validate().empty()) throw std::runtime_error("native_configuration_rejected");
        auto safe = sanitize(effective, removed);
        safe.save(request.at("output_flat_path").get<std::string>());
        result["selection"] = selection;
        if (request.contains("overrides_path")) {
            output = PresetBundle();
            set_data_dir(request.at("datadir").get<std::string>() + "/partition");
            output.setup_directories();
            AppConfig partition_app{AppConfig::EAppMode::Editor};
            output.load_presets(partition_app, ForwardCompatibilitySubstitutionRule::Disable);
            output.load_config_from_wizard("Snapshot", safe);
            // Native full-config partitioning assigns distinct material names per extruder.
            // Sanitize again because native preset defaults restore omitted options.
            PresetBundle sanitized;
            for (auto *collection : collections(output)) for (const auto &preset : collection->get_presets())
                if (!preset.is_default) {
                    const std::string &name = collection == &output.printers ? printer_name :
                        collection == &(sla ? output.sla_prints : output.prints) ? print_name : preset.name;
                    sanitized.get_presets(collection->type()).load_preset("", name, sanitize(preset.config, removed), false);
                }
            const std::string exported_printer = printer_name;
            const std::string exported_print = print_name;
            std::vector<std::string> exported_materials;
            if (sla) exported_materials.push_back(output.sla_materials.get_selected_preset_name());
            else for (const auto &extruder : output.extruders_filaments) exported_materials.push_back(extruder.get_selected_preset_name());
            output = std::move(sanitized);
            select(output.printers, exported_printer);
            select(sla ? output.sla_prints : output.prints, exported_print);
            output.update_multi_material_filament_presets();
            for (size_t i = 0; i < exported_materials.size(); ++i) {
                select(sla ? output.sla_materials : output.filaments, exported_materials[i]);
                if (!sla) output.set_filament_preset(i, exported_materials[i]);
            }
            result["source_selection"] = selection;
            result["selection"] = {{"printer", exported_printer}, {"print", exported_print}, {"materials", exported_materials}};
        }
        result["technology"] = sla ? "SLA" : "FFF";
    }
    for (auto *collection : collections(output)) for (const auto &preset : collection->get_presets())
        if (!preset.is_default) result["profiles"].push_back(profile(*collection, preset));
    output.export_configbundle(request.at("output_bundle_path").get<std::string>(), false, false);
    result["omitted_fields"] = removed;
    return result;
}
int main(int argc, char **argv) {
    boost::log::core::get()->set_logging_enabled(false);
    const int saved_stdout = dup(STDOUT_FILENO);
    const int saved_stderr = dup(STDERR_FILENO);
    std::freopen("/dev/null", "w", stdout);
    std::freopen("/dev/null", "w", stderr);
    std::ostringstream suppressed;
    auto *stdout_buffer = std::cout.rdbuf(suppressed.rdbuf());
    auto *stderr_buffer = std::cerr.rdbuf(suppressed.rdbuf());
    json result;
    int status = 0;
    try {
        if (argc != 2) throw std::runtime_error("invalid_selection");
        std::ifstream input(argv[1]);
        const json request = json::parse(input);
        result = run(request);
    } catch (const std::exception &error) {
        const std::set<std::string> codes = {"unknown_preset", "invalid_selection", "incompatible_preset"};
        const std::string message = error.what();
        result = {{"protocol", 1}, {"version", "2.9.6"}, {"error", codes.count(message) ? message : "native_configuration_rejected"}};
        status = 1;
    }
    std::fflush(stdout);
    std::fflush(stderr);
    dup2(saved_stdout, STDOUT_FILENO);
    dup2(saved_stderr, STDERR_FILENO);
    close(saved_stdout);
    close(saved_stderr);
    std::cout.rdbuf(stdout_buffer);
    std::cerr.rdbuf(stderr_buffer);
    std::cout << result.dump() << '\n';
    return status;
}
