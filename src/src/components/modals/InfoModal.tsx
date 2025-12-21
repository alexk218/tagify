import React, { useState } from "react";
import Portal from "@/components/ui/Portal";
import styles from "./InfoModal.module.css";
import packageJson from "@/package";

import {
  faBook,
  faBaby,
  faTag,
  faStar,
  faRocket,
  faTimes,
  faBrain,
  faBug,
  faWandMagicSparkles,
  faMusic,
  faLock,
  faBox,
  faHardDrive,
  faSearch,
  faBullseye,
  faComments,
  faSmile,
  faGuitar,
  faDownload,
  faHeadphones,
  faCheckCircle,
  faCommentDots,
  faArrowUpRightFromSquare,
  faLightbulb,
  faChartBar,
  faBullhorn,
  faBolt,
  faFilter,
  faCoffee,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGithub } from "@fortawesome/free-brands-svg-icons";

interface InfoModalProps {
  onClose: () => void;
}

const InfoModal: React.FC<InfoModalProps> = ({ onClose }) => {
  const [activeSection, setActiveSection] = useState("whats-new");

  const sections = [
    { id: "whats-new", title: "What's New", icon: faBullhorn },
    { id: "overview", title: "Overview", icon: faBook },
    { id: "getting-started", title: "Getting Started", icon: faBaby },
    { id: "tagging", title: "Tagging System", icon: faTag },
    { id: "features", title: "Features", icon: faStar },
    { id: "roadmap", title: "What's Coming", icon: faRocket },
  ];

  const getReleaseUrl = (version: string) => {
    return `https://github.com/alexk218/tagify/releases/tag/v${version}`;
  };

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>
              <span className={styles.titleIcon}>
                <FontAwesomeIcon icon={faTag} />
              </span>
              Tagify Guide
            </h2>
            <button className={styles.closeButton} onClick={onClose}>
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>

          <div className={styles.modalContent}>
            {/* Navigation Sidebar */}
            <div className={styles.sidebar}>
              <nav className={styles.navigation}>
                {sections.map((section) => (
                  <button
                    key={section.id}
                    className={`${styles.navButton} ${
                      activeSection === section.id ? styles.navButtonActive : ""
                    } ${
                      section.id === "whats-new" ? styles.whatsNewButton : ""
                    }`}
                    onClick={() => setActiveSection(section.id)}
                  >
                    <span className={styles.navIcon}>
                      <FontAwesomeIcon icon={section.icon} />
                    </span>
                    <span className={styles.navText}>{section.title}</span>
                    {section.id === "whats-new" && (
                      <span className={styles.newIndicator}>NEW</span>
                    )}
                  </button>
                ))}
              </nav>
            </div>

            {/* Content Area */}
            <div className={styles.content}>
              {activeSection === "overview" && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>Welcome to Tagify!</h3>
                  <p className={styles.text}>
                    Tagify is a powerful music organization tool that transforms
                    how you manage your Spotify library.
                    <br />
                    Tag your tracks with a star rating, energy rating, and your
                    own custom tags.
                    <br />
                    Create playlists by filtering your tagged tracks based on
                    your own custom tags.
                  </p>

                  <div className={styles.featureGrid}>
                    <div className={styles.featureCard}>
                      <div className={styles.featureIcon}>
                        <FontAwesomeIcon icon={faTag} />
                      </div>
                      <h4>Custom Tagging</h4>
                      <p>
                        Organize tracks with custom categories like mood, genre,
                        energy, and context
                      </p>
                    </div>
                    <div className={styles.featureCard}>
                      <div className={styles.featureIcon}>
                        <FontAwesomeIcon icon={faStar} />
                      </div>
                      <h4>Rating System</h4>
                      <p>
                        Rate tracks from 1-5 stars and set energy levels from
                        1-10
                      </p>
                    </div>
                    <div className={styles.featureCard}>
                      <div className={styles.featureIcon}>
                        <FontAwesomeIcon icon={faSearch} />
                      </div>
                      <h4>Advanced Filtering</h4>
                      <p>
                        Find the perfect tracks using multiple filters and smart
                        search
                      </p>
                    </div>
                    <div className={styles.featureCard}>
                      <div className={styles.featureIcon}>
                        <FontAwesomeIcon icon={faBrain} />
                      </div>
                      <h4>Smart Playlists</h4>
                      <p>
                        Automatically sync tracks to playlists based on your
                        tags and criteria
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAGIFY 2.1.0 */}
              {activeSection === "whats-new" && (
                <div className={styles.section}>
                  <div className={styles.whatsNewHeader}>
                    <h3 className={styles.sectionTitle}>
                      <a
                        href={getReleaseUrl("2.1.0")}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        What's New in Tagify 2.1.0
                      </a>
                    </h3>
                  </div>

                  {/* Bulk Ratings Feature */}
                  <div className={styles.featureGroup}>
                    <div className={styles.featureHeader}>
                      <span className={styles.featureIcon}>
                        <FontAwesomeIcon icon={faStar} />
                      </span>
                      <h4 className={styles.featureTitle}>
                        Bulk Ratings & Energy
                      </h4>
                      <span className={styles.newBadge}>NEW</span>
                    </div>
                    <p className={styles.featureDescription}>
                      The bulk tagging interface now supports{" "}
                      <strong>star ratings</strong> and{" "}
                      <strong>energy levels</strong> in addition to tags. Apply
                      ratings to multiple tracks at once, or use track locking
                      to set individual ratings within bulk mode.
                    </p>

                    <div className={styles.usageInstructions}>
                      <strong>How to bulk tag:</strong> Select multiple tracks
                      in any playlist, right-click, and choose{" "}
                      <strong>"Bulk Tag"</strong> to open the bulk tagging
                      interface.
                    </div>
                  </div>

                  {/* TAGIFY 2.0.0 */}
                  <div className={styles.section}>
                    <div className={styles.whatsNewHeader}>
                      <h3 className={styles.sectionTitle}>
                        <a
                          href={getReleaseUrl("2.0.0")}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          What's New in Tagify 2.0.0
                        </a>
                      </h3>
                    </div>

                    {/* Smart Playlists Feature */}
                    <div className={styles.featureGroup}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faBrain} />
                        </span>
                        <h4 className={styles.featureTitle}>Smart Playlists</h4>
                        <span className={styles.newBadge}>NEW</span>
                      </div>
                      <p className={styles.featureDescription}>
                        Create playlists that automatically stay up-to-date. Set
                        your criteria once, and every track you tag that matches
                        will be <strong>instantly added</strong> - no manual
                        playlist management needed!.
                      </p>

                      {/* Visual Tutorial */}
                      <div className={styles.visualTutorial}>
                        {/* Step 1: Creating Smart Playlist */}
                        <div className={styles.tutorialStep}>
                          <div className={styles.stepInfo}>
                            <div className={styles.stepBadge}>Step 1</div>
                            <div className={styles.stepDetails}>
                              <h6 className={styles.stepTitle}>
                                Define Your Smart Playlist
                              </h6>
                              <p className={styles.stepDesc}>
                                Choose your filters: star ratings, custom tags,
                                energy levels, or BPM ranges. <br />
                                This example uses <strong>5 star</strong> tracks
                                tagged <strong>Disco</strong>.
                              </p>
                            </div>
                          </div>
                          <div className={styles.gifContainer}>
                            <img
                              src="https://raw.githubusercontent.com/alexk218/tagify/main/src/assets/CREATING_SMART_PLAYLIST.gif"
                              alt="Creating a smart playlist with 5 star rating and Disco tag criteria"
                              className={styles.tutorialGif}
                              loading="lazy"
                            />
                            <div className={styles.gifCaption}>
                              Defining the rules for automatic playlist creation
                            </div>
                          </div>
                        </div>

                        {/* Step 2: Automatic Addition */}
                        <div className={styles.tutorialStep}>
                          <div className={styles.stepInfo}>
                            <div className={styles.stepBadge}>Step 2</div>
                            <div className={styles.stepDetails}>
                              <h6 className={styles.stepTitle}>
                                Watch the Magic Happen
                              </h6>
                              <p className={styles.stepDesc}>
                                Now, when tagging any track with{" "}
                                <strong>5 stars</strong> and the{" "}
                                <strong>Disco</strong> tag - it jumps into your
                                playlist automatically.
                              </p>
                            </div>
                          </div>
                          <div className={styles.gifContainer}>
                            <img
                              src="https://raw.githubusercontent.com/alexk218/tagify/main/src/assets/SATISFYING_SMART_CRITERIA.gif"
                              alt="Tagging a track that automatically gets added to the smart playlist"
                              className={styles.tutorialGif}
                              loading="lazy"
                            />
                            <div className={styles.gifCaption}>
                              Track automatically added to playlist when
                              criteria are satisfied
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bug Fixes */}
                    <div className={styles.featureGroup}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faBug} />
                        </span>
                        <h4 className={styles.featureTitle}>Bug Fixes</h4>
                      </div>
                      <div className={styles.bugFixList}>
                        <div className={styles.bugFix}>
                          <span className={styles.bugFixIcon}>
                            <FontAwesomeIcon icon={faLock} />
                          </span>
                          <div>
                            <strong>Lock state persistence:</strong> Fixed issue
                            where lock state didn't persist after exiting the
                            app
                          </div>
                        </div>
                        <div className={styles.bugFix}>
                          <span className={styles.bugFixIcon}>
                            <FontAwesomeIcon icon={faBolt} />
                          </span>
                          <div>
                            <strong>Instant tag application:</strong> Tags are
                            now applied immediately - no more waiting or losing
                            changes when quickly leaving the app
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Improvements */}
                    <div className={styles.featureGroup}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faWandMagicSparkles} />
                        </span>
                        <h4 className={styles.featureTitle}>Improvements</h4>
                      </div>
                      <div className={styles.improvementList}>
                        <div className={styles.improvement}>
                          <span className={styles.improvementIcon}>
                            <FontAwesomeIcon icon={faWandMagicSparkles} />
                          </span>
                          <div>
                            <strong>Visual enhancements:</strong> Tagify is
                            prettier
                          </div>
                        </div>
                        <div className={styles.improvement}>
                          <span className={styles.improvementIcon}>
                            <FontAwesomeIcon icon={faChartBar} />
                          </span>
                          <div>
                            <strong>Real-time tracklist updates:</strong> Fixed
                            persistent orange bullets for empty tracks. The
                            tracklist column extension now shows accurate,
                            up-to-date tag data
                          </div>
                        </div>
                        <div className={styles.improvement}>
                          <span className={styles.improvementIcon}>
                            <FontAwesomeIcon icon={faMusic} />
                          </span>
                          <div>
                            <strong>Live playbar updates:</strong> Playbar
                            enhancer now updates in real-time based on track
                            tags, ratings, and energy. No more page refreshes
                            needed!
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === "getting-started" && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>Getting Started</h3>

                  <div className={styles.stepsList}>
                    <div className={styles.step}>
                      <div className={styles.stepNumber}>1</div>
                      <div className={styles.stepContent}>
                        <h4>Start with a Track</h4>
                        <p>
                          Play any song in Spotify, or use the context menu
                          (right-click) "Tag with Tagify" on any track to begin
                          tagging.
                        </p>
                      </div>
                    </div>

                    <div className={styles.step}>
                      <div className={styles.stepNumber}>2</div>
                      <div className={styles.stepContent}>
                        <h4>Add Your First Tags</h4>
                        <p>
                          Use the tag selector to categorize your track. Try
                          adding a genre, mood, or energy level to start.
                        </p>
                      </div>
                    </div>

                    <div className={styles.step}>
                      <div className={styles.stepNumber}>3</div>
                      <div className={styles.stepContent}>
                        <h4>Set Ratings & Energy</h4>
                        <p>
                          Rate the track with stars (1-5) and set an energy
                          level (1-10) to help with filtering later.
                        </p>
                      </div>
                    </div>

                    <div className={styles.step}>
                      <div className={styles.stepNumber}>4</div>
                      <div className={styles.stepContent}>
                        <h4>Filter & Create Playlists</h4>
                        <p>
                          Use the Track List to see all your tagged music and
                          experiment with filters to create playlists based on
                          your tags.
                        </p>
                      </div>
                    </div>

                    <div className={styles.step}>
                      <div className={styles.stepNumber}>5</div>
                      <div className={styles.stepContent}>
                        <h4>Create Custom Tags</h4>
                        <p>
                          Press "Manage Tags" to create your own custom tags!
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className={styles.step}>
                    <div className={styles.stepNumber}>6</div>
                    <div className={styles.stepContent}>
                      <h4>Protect Your Work - Backup Regularly</h4>
                      <p>
                        Your tags and smart playlists are stored locally in your
                        browser. While this is normally very reliable, it's
                        smart to periodically backup your data to ensure you
                        never lose your hard work. <br />
                        Backup your <strong>tag data</strong> using the{" "}
                        <FontAwesomeIcon icon={faDownload} /> Backup button in
                        the main menu. <br />
                        Backup your <strong>smart playlist data</strong> using
                        the <FontAwesomeIcon icon={faArrowUpRightFromSquare} />{" "}
                        Backup button in the Smart Playlist menu.
                      </p>
                    </div>
                  </div>

                  <div className={styles.tip}>
                    <strong>First-time tip:</strong> Start by tagging 10-15
                    songs with basic categories like genre and mood. This will
                    give you enough data to see how filtering works!
                  </div>
                </div>
              )}

              {activeSection === "tagging" && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>Tagging System</h3>

                  <div className={styles.subsection}>
                    <h4>How Tags Work</h4>
                    <p>Tags are organized in a three-level hierarchy:</p>
                    <div className={styles.hierarchy}>
                      <div className={styles.hierarchyLevel}>
                        <strong>Category</strong> →{" "}
                        <span className={styles.example}>Mood & Energy</span>
                      </div>
                      <div className={styles.hierarchyLevel}>
                        <strong>Subcategory</strong> →{" "}
                        <span className={styles.example}>Emotional Tone</span>
                      </div>
                      <div className={styles.hierarchyLevel}>
                        <strong>Tag</strong> →{" "}
                        <span className={styles.example}>
                          Happy, Sad, Romantic
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.subsection}>
                    <h4>Default Categories</h4>
                    <div className={styles.categoryList}>
                      <div className={styles.categoryItem}>
                        <h5>
                          <FontAwesomeIcon icon={faMusic} /> Genre & Style
                        </h5>
                        <p>
                          Primary genres, sub-genres, and era classifications
                        </p>
                      </div>
                      <div className={styles.categoryItem}>
                        <h5>
                          <FontAwesomeIcon icon={faSmile} /> Mood & Energy
                        </h5>
                        <p>
                          Energy levels, emotional tones, and atmospheric
                          qualities
                        </p>
                      </div>
                      <div className={styles.categoryItem}>
                        <h5>
                          <FontAwesomeIcon icon={faGuitar} /> Musical Elements
                        </h5>
                        <p>Vocals, instruments, and production styles</p>
                      </div>
                      <div className={styles.categoryItem}>
                        <h5>
                          <FontAwesomeIcon icon={faBullseye} /> Usage & Context
                        </h5>
                        <p>
                          Activities, timing, and social contexts for listening
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className={styles.tip}>
                    Customize your entire tag system in "Manage Tags"!
                  </div>
                </div>
              )}

              {activeSection === "features" && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>How to Use Tagify</h3>

                  <div className={styles.featuresCompact}>
                    {/* 1. Create/Manage Tags */}
                    <div className={styles.featureItem}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faTag} />
                        </span>
                        <h4>1. Create & Manage Tags</h4>
                      </div>
                      <p>
                        Click <strong>"Manage Tags"</strong> to build your
                        custom tagging system. Create categories (e.g., "Mood"),
                        subcategories (e.g., "Happy"), and individual tags
                        (e.g., "Upbeat"). This forms the foundation of your
                        music organization.
                      </p>
                    </div>

                    {/* 2. Apply ratings, energy, and tags */}
                    <div className={styles.featureItem}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faStar} />
                        </span>
                        <h4>2. Rate, Tag & Set Energy</h4>
                      </div>
                      <p>
                        For any track, set <strong>star ratings (1-5)</strong>,{" "}
                        <strong>energy levels (1-10)</strong>, and apply your
                        custom tags. Use the tag selector interface to quickly
                        tag tracks by mood, genre, activity, or any system you
                        create.
                      </p>
                    </div>

                    {/* 3. Update BPM */}
                    <div className={styles.featureItem}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faMusic} />
                        </span>
                        <h4>3. BPM Management</h4>
                      </div>
                      <p>
                        Sometimes Spotify doesn't get the BPM right...
                        <br />
                        Click any BPM value to edit manually, or use the refresh
                        button (<FontAwesomeIcon icon={faRocket} />) to fetch
                        updated BPM from Spotify's audio analysis. Perfect for
                        creating tempo-specific playlists.
                      </p>
                    </div>

                    {/* 4. Lock tracks */}
                    <div className={styles.featureItem}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faLock} />
                        </span>
                        <h4>4. Track Locking</h4>
                      </div>
                      <p>
                        Lock to a specific track to prevent automatic switching
                        when Spotify changes songs. Essential for focused
                        tagging sessions without interruption.
                      </p>
                    </div>

                    {/* 5. Bulk tagging */}
                    <div className={styles.featureItem}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faBox} />
                        </span>
                        <h4>5. Bulk Tagging</h4>
                      </div>
                      <p>
                        Select multiple tracks in any Spotify playlist (Ctrl+A
                        for all), right-click, and choose
                        <strong>"Bulk Tag"</strong> to tag them simultaneously.
                      </p>
                    </div>

                    {/* 6. Import/Export */}
                    <div className={styles.featureItem}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faHardDrive} />
                        </span>
                        <h4>6. Backup your data!</h4>
                      </div>
                      <p>
                        <strong>Tag Data Export/Import:</strong> Download your
                        complete tag library as JSON backup. Import to restore
                        all tags, ratings, and metadata across devices.
                        <br />
                        <strong>Smart Playlist Export/Import:</strong> Backup
                        your smart playlist configurations (criteria, filters,
                        settings) separately from the Smart Playlists panel.
                        <br />
                        <strong>Why backup both?</strong> Tag data contains your
                        music ratings and tags, while smart playlist data
                        contains your automation rules. Both are essential for a
                        complete restore (in case something goes wrong...). Also
                        allows you to share data between devices!
                        <br />
                        <FontAwesomeIcon icon={faLightbulb} />{" "}
                        <strong>Best Practice:</strong> Export both monthly and
                        before major changes like deleting tag categories or
                        modifying smart playlist criteria.
                      </p>
                    </div>

                    {/* 7. Smart filtering + playlist creation */}
                    <div className={styles.featureItem}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faSearch} />
                        </span>
                        <h4>7. Smart Filtering & Playlist Creation</h4>
                      </div>
                      <p>
                        Filter by any combination of tags (include/exclude),
                        ratings, energy levels, and BPM ranges.
                        <br />
                        Click tags once for{" "}
                        <span className={styles.includeTag}>include</span>,
                        twice for
                        <span className={styles.excludeTag}>exclude</span>.
                        <br />
                        <strong>Filter Logic:</strong>{" "}
                        <span className={styles.filterMode}>ALL</span> = tracks
                        must have ALL selected tags,{" "}
                        <span className={styles.filterMode}>ANY</span> = tracks
                        need at least ONE selected tag.
                        <br />
                        Then click <strong>"Create Playlist"</strong>
                        or <strong>"Play All"</strong> to enjoy your filtered
                        results.
                      </p>
                    </div>

                    {/* 8. Tracklist/playbar icons */}
                    <div className={styles.featureItem}>
                      <div className={styles.featureHeader}>
                        <span className={styles.featureIcon}>
                          <FontAwesomeIcon icon={faBullseye} />
                        </span>
                        <h4>8. Visual Tag Indicators</h4>
                      </div>
                      <div className={styles.indicatorDemo}>
                        <p>
                          Track status indicators appear in playlists and the
                          playbar:
                        </p>
                        <div className={styles.indicatorExamples}>
                          <div className={styles.indicatorExample}>
                            <span className={styles.orangeBullet}>●</span>
                            <span>Orange = Missing tags (needs attention)</span>
                          </div>
                          <div className={styles.indicatorExample}>
                            <span className={styles.greenBullet}>●</span>
                            <span>Green = Fully tagged (complete)</span>
                          </div>
                        </div>
                        <p className={styles.indicatorTip}>
                          <strong>Click</strong> any indicator to tag that track
                          instantly.
                          <br />
                          <strong>Hover</strong> to see current tags.
                          <br />
                          You can disable both tracklist & playbar indicators in
                          settings.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === "roadmap" && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>What's Coming Next...</h3>
                  <p className={styles.text}>
                    Here's what's planned for future releases:
                  </p>

                  {/* Upcoming Features */}
                  <div className={styles.roadmapList}>
                    <div className={styles.roadmapItem}>
                      <div className={styles.roadmapHeader}>
                        <span className={styles.roadmapIcon}>
                          <FontAwesomeIcon icon={faStar} />
                        </span>
                        <h4 className={styles.roadmapTitle}>
                          Tag & Rate Playlists
                        </h4>
                        <span className={styles.comingSoonBadge}>
                          Coming Soon
                        </span>
                      </div>
                      <p className={styles.roadmapDescription}>
                        In addition to tagging and rating individual tracks,
                        you'll be able to tag and rate your entire playlists.
                        Perfect for quickly organizing your collections at a
                        higher level.
                      </p>
                    </div>

                    <div className={styles.roadmapItem}>
                      <div className={styles.roadmapHeader}>
                        <span className={styles.roadmapIcon}>
                          <FontAwesomeIcon icon={faFilter} />
                        </span>
                        <h4 className={styles.roadmapTitle}>
                          Advanced Filtering
                        </h4>
                        <span className={styles.plannedBadge}>Planned</span>
                      </div>
                      <p className={styles.roadmapDescription}>
                        Mix AND/OR in a single formula (e.g., Tag1 && (Tag2 ||
                        Tag3)) for more powerful and flexible filtering of your
                        tracks and playlists.
                      </p>
                    </div>

                    <div className={styles.roadmapItem}>
                      <div className={styles.roadmapHeader}>
                        <span className={styles.roadmapIcon}>
                          <FontAwesomeIcon icon={faHeadphones} />
                        </span>
                        <h4 className={styles.roadmapTitle}>
                          Rekordbox Integration
                        </h4>
                        <span className={styles.plannedBadge}>Planned</span>
                      </div>
                      <p className={styles.roadmapDescription}>
                        Sync your tags and star ratings between rekordbox and
                        Tagify.
                      </p>
                    </div>

                    <div className={styles.roadmapItem}>
                      <div className={styles.roadmapHeader}>
                        <span className={styles.roadmapIcon}>
                          <FontAwesomeIcon icon={faDownload} />
                        </span>
                        <h4 className={styles.roadmapTitle}>Download Tracks</h4>
                        <span className={styles.plannedBadge}>Planned</span>
                      </div>
                      <p className={styles.roadmapDescription}>
                        Download tracks directly within Spotify for offline
                        organization!
                      </p>
                    </div>
                    {/* Community Section */}
                    <div className={styles.communitySection}>
                      <div className={styles.communityHeader}>
                        <span className={styles.communityIcon}>
                          <FontAwesomeIcon icon={faComments} />
                        </span>
                        <h4 className={styles.communityTitle}>
                          Join the Community
                        </h4>
                      </div>
                      <p className={styles.communityDescription}>
                        Want to influence Tagify's development? Join our GitHub
                        Discussions to:
                      </p>
                      <div className={styles.communityFeatures}>
                        <div className={styles.communityFeature}>
                          <span className={styles.featureCheckmark}>
                            <FontAwesomeIcon icon={faCheckCircle} />
                          </span>
                          <span>See the detailed roadmap</span>
                        </div>
                        <div className={styles.communityFeature}>
                          <span className={styles.featureCheckmark}>
                            <FontAwesomeIcon icon={faCheckCircle} />
                          </span>
                          <span>Post ideas & feature requests</span>
                        </div>
                        <div className={styles.communityFeature}>
                          <span className={styles.featureCheckmark}>
                            <FontAwesomeIcon icon={faCheckCircle} />
                          </span>
                          <span>Vote on which features you want most</span>
                        </div>
                      </div>

                      <div className={styles.communityAction}>
                        <a
                          href="https://github.com/alexk218/tagify/discussions"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.discussionsLink}
                        >
                          <span className={styles.discussionsIcon}>
                            <FontAwesomeIcon icon={faCommentDots} />
                          </span>
                          Visit GitHub Discussions
                          <span className={styles.externalLinkIcon}>
                            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                          </span>
                        </a>
                      </div>
                    </div>
                    <a
                      href="https://forms.gle/UoAFsHnWjzieUQFm8"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.surveyLink}
                    >
                      <span className={styles.surveyIcon}>
                        <FontAwesomeIcon icon={faLightbulb} />
                      </span>
                      Share Feedback & Ideas. Help shape Tagify's roadmap.
                      <span className={styles.externalLinkIcon}>
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                      </span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.modalFooter}>
            <div className={styles.footerContent}>
              <div className={styles.footerInfo}>
                <span className={styles.version}>
                  Tagify v{packageJson.version}
                </span>
                <span className={styles.divider}>•</span>
                <a
                  href="https://github.com/alexk218/tagify"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Help others discover Tagify - star the repo! (please)"
                  className={styles.githubLink}
                >
                  <FontAwesomeIcon
                    icon={faGithub}
                    size="xl"
                    beatFade
                    className="fa-fade"
                    style={
                      {
                        "--fa-animation-duration": "3s",
                        "--fa-beat-fade-scale": "1.20",
                      } as React.CSSProperties & Record<string, string>
                    }
                  />
                </a>
                <a
                  href="https://buymeacoffee.com/alexk218"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Give Alex a coffee :) (he probably needs it)"
                  className={styles.githubLink}
                >
                  <FontAwesomeIcon
                    icon={faCoffee}
                    size="lg"
                    bounce
                    className="fa-bounce"
                    style={
                      {
                        "--fa-animation-duration": "5s",
                        "--fa-bounce-height": "-15px",
                      } as React.CSSProperties & Record<string, string>
                    }
                  />
                </a>
              </div>
              <button className={styles.primaryButton} onClick={onClose}>
                Start Tagging!
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default InfoModal;
